import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Context, Effect, Layer } from "effect";
import { anchor } from "../../anchor";
import { contentBlockId, reconcileBlocks } from "../../content-reconcile";
import { Db } from "../client";
import { comments, contentBlockRevs, contentBlocks, documents } from "../schema";
import type { DbFailure } from "../../effect/errors";

/**
 * The content-block store: the paragraph-level identity a document's markdown folds into.
 * `reconcile` is called from every path that rewrites `documents.body` (the file index, the
 * stream refold); it keeps ids stable across rewrites, soft-deletes removed paragraphs, and
 * backfills `comments.block_id` for any quote that still resolves — orphaned legacy quotes
 * stay null on purpose.
 */
export type ContentBlockRow = typeof contentBlocks.$inferSelect;
export type ReconcileReport = { bodyRev: number; added: number; modified: number; removed: number };

/** What a stored quote selector resolves to: the live block holding that passage. */
export type QuoteResolution = { blockId: string; blockRev: number };

/**
 * The reconcile body, run inside the caller's `db.use` so the body write and the block write
 * commit together — the stream refold and the file index both call this after storing `body`.
 */
export function applyReconcile(d: BunSQLiteDatabase, documentId: string, body: string | null): ReconcileReport {
  const doc = d.select({ id: documents.id, bodyRev: documents.bodyRev }).from(documents).where(eq(documents.id, documentId)).get();
  if (!doc) throw new Error(`reconcile: no document ${documentId}`);
  const bodyRev = (doc.bodyRev ?? 0) + 1;
  const at = new Date().toISOString();
  const oldRows = d
    .select()
    .from(contentBlocks)
    .where(and(eq(contentBlocks.documentId, documentId), isNull(contentBlocks.deletedAt)))
    .orderBy(asc(contentBlocks.n))
    .all();

  // File gone: every live block is soft-deleted, ids and last texts stay on record.
  if (body === null) {
    for (const r of oldRows) d.update(contentBlocks).set({ deletedAt: at, updatedRev: bodyRev }).where(eq(contentBlocks.id, r.id)).run();
    d.update(documents).set({ bodyRev }).where(eq(documents.id, documentId)).run();
    return { bodyRev, added: 0, modified: 0, removed: oldRows.length };
  }

  const plan = reconcileBlocks(oldRows, body);

  // Unchanged in text, but position fields refresh anyway.
  for (const m of plan.live) {
    if (m.modified) continue;
    d.update(contentBlocks).set({ n: m.n, grp: m.spec.grp }).where(eq(contentBlocks.id, m.id)).run();
  }

  // Modified: old text into the revs table, row carries the new text at rev+1.
  for (const m of plan.live) {
    if (!m.modified) continue;
    const old = oldRows.find((r) => r.id === m.id);
    if (!old) continue;
    d.insert(contentBlockRevs).values({ blockId: old.id, rev: old.rev, text: old.text, plain: old.plain, at }).run();
    d.update(contentBlocks)
      .set({ n: m.n, grp: m.spec.grp, kind: m.spec.kind, text: m.spec.text, plain: m.spec.plain, hash: m.spec.hash, rev: old.rev + 1, updatedRev: bodyRev })
      .where(eq(contentBlocks.id, m.id))
      .run();
  }

  // Added: brand new ids.
  for (const a of plan.added) {
    d.insert(contentBlocks)
      .values({ id: contentBlockId(), documentId, n: a.n, grp: a.spec.grp, kind: a.spec.kind, text: a.spec.text, plain: a.spec.plain, hash: a.spec.hash, rev: 1, updatedRev: bodyRev, createdAt: at })
      .run();
  }

  // Removed: soft delete, last text preserved.
  for (const id of plan.removed) d.update(contentBlocks).set({ deletedAt: at, updatedRev: bodyRev }).where(eq(contentBlocks.id, id)).run();

  d.update(documents).set({ bodyRev }).where(eq(documents.id, documentId)).run();

  // Backfill: quotes that still resolve get the block they landed on. The unresolvable stay
  // null — only comments that can still anchor get an id, the broken ones are left alone.
  const orphans = d
    .select()
    .from(comments)
    .where(and(eq(comments.documentId, documentId), isNull(comments.blockId), sql`${comments.quote} IS NOT NULL`))
    .all();
  const live = d
    .select()
    .from(contentBlocks)
    .where(and(eq(contentBlocks.documentId, documentId), isNull(contentBlocks.deletedAt)))
    .orderBy(asc(contentBlocks.n))
    .all();
  for (const c of orphans) {
    const q = c.quote;
    if (!q) continue;
    const hit = live.find((b) => anchor(b.plain, q) !== null);
    if (hit) d.update(comments).set({ blockId: hit.id, blockRev: hit.rev }).where(eq(comments.id, c.id)).run();
  }

  return { bodyRev, added: plan.added.length, modified: plan.live.filter((m) => m.modified).length, removed: plan.removed.length };
}

export class ContentBlocksRepo extends Context.Service<
  ContentBlocksRepo,
  {
    /** Live blocks of the document, in order. */
    list(home: string, documentId: string): Effect.Effect<ContentBlockRow[], DbFailure>;
    /** One block by id, or null. */
    get(home: string, blockId: string): Effect.Effect<ContentBlockRow | null, DbFailure>;
    /** The text a block carried at `rev` (current rev reads the row, older ones the rev table). */
    revText(home: string, blockId: string, rev: number): Effect.Effect<string | null, DbFailure>;
    /**
     * Fold a new body into the document's blocks: stable ids, +1 rev per rewrite, soft delete,
     * `documents.body_rev` bumps, and `comments.block_id` is backfilled for quotes that still
     * resolve. A null body (file gone) removes every block.
     */
    reconcile(home: string, documentId: string, body: string | null): Effect.Effect<ReconcileReport, DbFailure>;
    /** The live block a quote selector lands on, or null. */
    resolveQuote(home: string, documentId: string, quote: { exact: string; prefix: string; suffix: string }): Effect.Effect<QuoteResolution | null, DbFailure>;
  }
>()("blackboard/ContentBlocksRepo") {}

export const layer = Layer.effect(
  ContentBlocksRepo,
  Effect.gen(function* () {
    const db = yield* Db;

    return ContentBlocksRepo.of({
      list: (home, documentId) =>
        db.use(home, (d) =>
          d.select().from(contentBlocks).where(and(eq(contentBlocks.documentId, documentId), isNull(contentBlocks.deletedAt))).orderBy(asc(contentBlocks.n)).all(),
        ),

      get: (home, blockId) =>
        db.use(home, (d) => d.select().from(contentBlocks).where(eq(contentBlocks.id, blockId)).get() ?? null),

      revText: (home, blockId, rev) =>
        db.use(home, (d) => {
          const row = d.select().from(contentBlocks).where(eq(contentBlocks.id, blockId)).get();
          if (!row) return null;
          if (row.rev === rev) return row.text;
          return d.select().from(contentBlockRevs).where(and(eq(contentBlockRevs.blockId, blockId), eq(contentBlockRevs.rev, rev))).get()?.text ?? null;
        }),

      resolveQuote: (home, documentId, quote) =>
        db.use(home, (d) => {
          const rows = d
            .select()
            .from(contentBlocks)
            .where(and(eq(contentBlocks.documentId, documentId), isNull(contentBlocks.deletedAt)))
            .orderBy(asc(contentBlocks.n))
            .all();
          for (const b of rows) {
            if (anchor(b.plain, quote) !== null) return { blockId: b.id, blockRev: b.rev } as QuoteResolution;
          }
          return null;
        }),

      reconcile: (home, documentId, body) => db.use(home, (d) => applyReconcile(d, documentId, body)),
    });
  }),
);

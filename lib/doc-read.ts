import { Context, Effect } from "effect";
import { eq, sql } from "drizzle-orm";
import { Db } from "./db/client";
import { documents, comments } from "./db/schema";
import { RepoMemo } from "./doc-index";
import { indexRow } from "./doc-index-run";
import type { DocMeta } from "./doc-meta";
import type { DbFailure, IoFailure } from "./effect/errors";
import type { Session } from "./session-model";

/** The Db service instance, as the layer provides it. */
type Service = Context.Service.Shape<typeof Db>;

/** A database row for one document, plus the newest time any of its comments carries. */
export type IndexedRow = typeof documents.$inferSelect & { latestCommentAt: string | null };

/** The row for one session. Null when the id names no row. */
export function readRow(db: Service, home: string, id: string): Effect.Effect<IndexedRow | null, DbFailure> {
  return db.use(home, (d) => {
      const row = d.select().from(documents).where(eq(documents.id, id)).get();
      if (!row) return null;
      const latest = d
        .select({ at: sql<string | null>`max(max(${comments.createdAt}), coalesce(max(${comments.editedAt}), ''), coalesce(max(${comments.resolvedAt}), ''), coalesce(max(${comments.reopenedAt}), ''))` })
        .from(comments)
        .where(eq(comments.documentId, id))
        .get();
      return { ...row, latestCommentAt: latest?.at || null };
  });
}

/** The indexed markdown for a session: its body when the row holds one, null when the file was missing at index time. */
export function indexedBody(db: Service, home: string, id: string): Effect.Effect<string | null, DbFailure> {
  return db.use(home, (d) => {
    const row = d.select({ body: documents.body }).from(documents).where(eq(documents.id, id)).get();
    return row?.body ?? null;
  });
}

/**
 * The row for a session, indexed first if it never was. The first call for an unindexed row reads its file and runs
 * git once; every later call reads the row only.
 */
export function indexIfNeeded(db: Service, home: string, session: Session): Effect.Effect<IndexedRow, IoFailure | DbFailure> {
  return Effect.gen(function* () {
    const first = yield* readRow(db, home, session.id);
    if (first && first.indexedAt !== null) return first;
    yield* indexRow(db, home, first ?? (yield* insertStub(db, home, session)), new RepoMemo());
    const after = yield* readRow(db, home, session.id);
    if (!after) return yield* Effect.die(new Error(`document ${session.id} vanished during indexing`));
    return after;
  });
}

/** A row for a session that the database does not hold yet (a registry entry predating the table). */
function insertStub(db: Service, home: string, session: Session): Effect.Effect<typeof documents.$inferSelect, DbFailure> {
  return Effect.gen(function* () {
    const row = { id: session.id, path: session.path, createdAt: session.createdAt, openedAt: session.openedAt, kind: session.kind ?? null, closedAt: null } as typeof documents.$inferSelect;
    yield* db.use(home, (d) => void d.insert(documents).values(row).onConflictDoNothing().run());
    return row;
  });
}

/** The later of two ISO times, either of which may be missing. */
export function latestOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * The metadata the session list and the inbox show, rebuilt from a row in the shape `docMeta` returned. A missing file
 * keeps its basename as title and carries no repo, as before.
 */
export function docMetaFromRow(row: IndexedRow): DocMeta {
  const missing = row.srcSize === -1 || row.body === null;
  const hasRepo = row.repoName !== null;
  return {
    title: row.title ?? basenameOf(row.path),
    repo: hasRepo ? { name: row.repoName!, root: row.repoRoot!, relPath: row.relPath ?? "" } : null,
    branch: row.branch ?? null,
    detached: !!row.detached,
    worktree: row.worktreeName !== null ? { name: row.worktreeName, path: row.worktreePath! } : null,
    project: row.projectName !== null ? { name: row.projectName, root: row.projectRoot! } : null,
    updatedAt: row.srcMtime !== null ? new Date(row.srcMtime).toISOString() : null,
    missing,
    stats: { sections: row.sections ?? 0, diagrams: row.diagrams ?? 0 },
  };
}

const basenameOf = (p: string | null) => (p ? p.slice(p.lastIndexOf("/") + 1) : "");

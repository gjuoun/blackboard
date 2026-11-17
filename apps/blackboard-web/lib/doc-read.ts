import { Safe } from "@gjuoun/safe-ts";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { comments, documents } from "./db/schema";
import { RepoMemo } from "./doc-index";
import { indexRow } from "./doc-index-run";
import type { DocMeta } from "./doc-meta";
import type { DbFailure, IoFailure } from "./errors";
import type { Session } from "./session-model";

/** A database row for one document, plus the newest time any of its comments carries. */
export type IndexedRow = typeof documents.$inferSelect & { latestCommentAt: string | null };

/** The row for one session. Null when the id names no row. */
export function readRow(db: Db, home: string, id: string): Safe<IndexedRow | null, DbFailure> {
  return db.use(home, (d) => {
    const row = d.select().from(documents).where(eq(documents.id, id)).get();
    if (!row) return null;
    const latest = d
      .select({
        at: sql<
          string | null
        >`max(max(${comments.createdAt}), coalesce(max(${comments.editedAt}), ''), coalesce(max(${comments.resolvedAt}), ''), coalesce(max(${comments.reopenedAt}), ''))`,
      })
      .from(comments)
      .where(eq(comments.documentId, id))
      .get();
    return { ...row, latestCommentAt: latest?.at ?? null };
  });
}

/** The indexed markdown for a session: its body when the row holds one, null when the file was missing at index time. */
export function indexedBody(db: Db, home: string, id: string): Safe<string | null, DbFailure> {
  return db.use(home, (d) => {
    const row = d.select({ body: documents.body }).from(documents).where(eq(documents.id, id)).get();
    return row?.body ?? null;
  });
}

/**
 * The row for a session, brought up to date with its file on every read: one stat per call, and a
 * re-read (plus git, plus the block reconcile) only when the file's mtime or size moved. The disk
 * file is the source of truth; the row is the cache a read refreshes.
 */
export function indexIfNeeded(
  db: Db,
  home: string,
  session: Session,
): Safe<IndexedRow, IoFailure | DbFailure> {
  return Safe.try(function* () {
    const first = (yield readRow(db, home, session.id)) as IndexedRow | null;
    const stub = first ?? ((yield insertStub(db, home, session)) as IndexedRow);
    yield indexRow(db, home, stub, new RepoMemo());
    const after = (yield readRow(db, home, session.id)) as IndexedRow | null;
    if (after) return after;
    return (yield Safe.err(
      new IoFailure({ message: `document ${session.id} vanished during indexing`, status: 500 }),
    )) as never;
  });
}

/** A row for a session that the database does not hold yet (a registry entry predating the table). */
function insertStub(
  db: Db,
  home: string,
  session: Session,
): Safe<typeof documents.$inferSelect, DbFailure> {
  return db.use(home, (d) => {
    const row = {
      id: session.id,
      path: session.path,
      createdAt: session.createdAt,
      openedAt: session.openedAt,
      closedAt: null,
    } as typeof documents.$inferSelect;
    d.insert(documents).values(row).onConflictDoNothing().run();
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
 * The metadata the session list and the inbox show, rebuilt from a row in the shape `docMeta`
 * returned. A missing file keeps its basename as title and carries no repo, as before.
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
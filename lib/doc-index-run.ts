import { Context, Effect } from "effect";
import { eq, isNull } from "drizzle-orm";
import { existsSync, statSync } from "node:fs";
import { Db } from "./db/client";
import { documents } from "./db/schema";
import { factsOf, RepoMemo } from "./doc-index";
import { errorMessage, IoFailure, type DbFailure } from "./effect/errors";

/** What one index run did. `updated` counts rows rewritten; a run over an unchanged database updates none. */
export type IndexReport = { scanned: number; updated: number; skipped: number; missing: number; gitCommands: number };

/** A file that is gone is recorded as missing: no body, and the size column holds this sentinel. */
const MISSING_SIZE = -1;

/** True when the row must be (re)read: never indexed, or the file is not the one the row was read from. */
function stale(row: { indexedAt: string | null; srcMtime: number | null; srcSize: number | null }, path: string): boolean {
  // Never indexed: nothing to trust yet.
  if (row.indexedAt === null) return true;
  // Indexed as missing, and still missing: the recorded state is the current state.
  if (!existsSync(path)) return row.srcSize !== MISSING_SIZE;
  // Indexed from a file that is now gone or back: a missing record is stale against a present file.
  if (row.srcSize === MISSING_SIZE) return true;
  const st = statSync(path);
  return row.srcMtime !== Math.floor(st.mtimeMs) || row.srcSize !== st.size;
}

/**
 * Index every open document whose stored body is missing or no longer matches its file. A run is idempotent: a second
 * run over an unchanged file system rewrites nothing. The git commands a run needs are shared across its documents.
 */
/** What one row's index step did: rewritten, left as it was, or recorded as missing. */
export type RowOutcome = "updated" | "skipped" | "missing";

/**
 * Bring one row up to date with its file: read the file once, rewrite the row, or leave it alone when it is current.
 * `memo` shares git answers with the other rows of the same run; a single-document call passes a fresh one.
 */
export function indexRow(
  db: Context.Service.Shape<typeof Db>,
  home: string,
  row: typeof documents.$inferSelect,
  memo: RepoMemo,
  force = false,
): Effect.Effect<RowOutcome, IoFailure | DbFailure> {
  return Effect.gen(function* () {
    if (!row.path || (!force && !stale(row, row.path))) return "skipped" as const;
    if (!existsSync(row.path)) {
      const now = new Date().toISOString();
      yield* db.use(home, (d) =>
        void d.update(documents).set({ body: null, title: row.title ?? null, srcMtime: null, srcSize: MISSING_SIZE, indexedAt: now }).where(eq(documents.id, row.id)).run(),
      );
      return "missing" as const;
    }
    const facts = yield* Effect.try({
      try: () => factsOf(row.path!, memo),
      catch: (error) => new IoFailure({ message: errorMessage(error), status: 500 }),
    });
    const now = new Date().toISOString();
    yield* db.use(home, (d) =>
      void d.update(documents).set({
        body: facts.body,
        title: facts.title,
        sections: facts.sections,
        diagrams: facts.diagrams,
        branch: facts.branch,
        detached: facts.detached,
        repoName: facts.repoName,
        repoRoot: facts.repoRoot,
        relPath: facts.relPath,
        worktreeName: facts.worktreeName,
        worktreePath: facts.worktreePath,
        projectName: facts.projectName,
        projectRoot: facts.projectRoot,
        srcMtime: facts.srcMtime,
        srcSize: facts.srcSize,
        indexedAt: now,
      }).where(eq(documents.id, row.id)).run(),
    );
    return "updated" as const;
  });
}

/** Index every open document whose row is missing or no longer matches its file. Idempotent: a second run updates nothing. */
export function indexDocuments(home: string, force = false): Effect.Effect<IndexReport, IoFailure | DbFailure, Db> {
  return Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* db.use(home, (d) => d.select().from(documents).where(isNull(documents.closedAt)).all());
    const memo = new RepoMemo();
    const report: IndexReport = { scanned: rows.length, updated: 0, skipped: 0, missing: 0, gitCommands: 0 };
    for (const row of rows) {
      const outcome = yield* indexRow(db, home, row, memo, force);
      if (outcome === "updated") report.updated += 1;
      else if (outcome === "missing") {
        report.missing += 1;
        report.updated += 1;
      } else report.skipped += 1;
    }
    report.gitCommands = memo.calls;
    return report;
  });
}

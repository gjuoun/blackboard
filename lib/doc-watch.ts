import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { Effect } from "effect";
import { and, eq, isNull } from "drizzle-orm";
import { Db } from "./db/client";
import { documents } from "./db/schema";
import { RepoMemo } from "./doc-index";
import { indexRow } from "./doc-index-run";

/** Events for one file arrive in bursts (an editor writes, renames, writes again). One index run covers a burst. */
export const COALESCE_MS = 200;

/**
 * Keep the database current with the files it indexed. One directory watcher per directory that holds a registered
 * document; a change to a document re-indexes its row once the burst settles. Returns a stop function.
 *
 * This runs with the API process, not with a page connection: the rows stay current whether or not anyone is
 * watching the document.
 */
export function startDocWatch(home: string, run: (effect: Effect.Effect<unknown, unknown, Db>) => Promise<unknown>): () => void {
  const watchers = new Map<string, FSWatcher>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const reindex = (id: string, _path: string) => {
    const memo = new RepoMemo();
    // Re-read the row by id, so a row closed since the watch started is skipped.
    const program = Effect.gen(function* () {
      const db = yield* Db;
      const row = yield* db.use(home, (d) => d.select().from(documents).where(and(eq(documents.id, id), isNull(documents.closedAt))).get() ?? null);
      if (!row || !row.path) return;
      yield* indexRow(db, home, row, memo);
    });
    run(program).catch(() => {});
  };
  const schedule = (id: string, path: string) => {
    const held = timers.get(id);
    if (held) clearTimeout(held);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      reindex(id, path);
    }, COALESCE_MS));
  };
  const watchDir = (dir: string, docs: { id: string; name: string; path: string }[]) => {
    if (watchers.has(dir)) return;
    try {
      const w = watch(dir, (_event, filename) => {
        if (!filename) return;
        for (const doc of docs) if (doc.name === filename) schedule(doc.id, doc.path);
      });
      w.on("error", () => {});
      watchers.set(dir, w);
    } catch {
      // A folder that is gone has nothing to watch; the next start will try again.
    }
  };

  run(Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.use(home, (d) => d.select({ id: documents.id, path: documents.path }).from(documents).where(isNull(documents.closedAt)).all());
  }).pipe(Effect.map((rows) => {
    const byDir = new Map<string, { id: string; name: string; path: string }[]>();
    for (const row of rows as { id: string; path: string | null }[]) {
      if (!row.path) continue;
      const dir = dirname(row.path);
      const list = byDir.get(dir) ?? [];
      list.push({ id: row.id, name: basename(row.path), path: row.path });
      byDir.set(dir, list);
    }
    for (const [dir, docs] of byDir) watchDir(dir, docs);
  }))).catch(() => {});

  return () => {
    for (const t of timers.values()) clearTimeout(t);
    for (const w of watchers.values()) w.close();
    watchers.clear();
    timers.clear();
  };
}

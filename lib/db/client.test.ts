import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Db, layer } from "./client";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-db-")));

/** One program against a temp home, the way a store or migration would run it. */
const run = <A>(effect: Effect.Effect<A, unknown, Db>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));

const tables = (home: string) =>
  run(
    Effect.gen(function* () {
      const db = yield* Db;
      return yield* db.raw(home, (raw) => (raw.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name));
    }),
  );

describe("Db", () => {
  test("opens a WAL, foreign-key-enabled database under a temp home", async () => {
    const home = fresh();
    const pragma = await run(
      Effect.gen(function* () {
        const db = yield* Db;
        return yield* db.raw(home, (raw) => {
          const q = (s: string) => (raw.query(s) as { get(): Record<string, number | string> }).get()!;
          return { journal: q("PRAGMA journal_mode").journal_mode, fk: q("PRAGMA foreign_keys").foreign_keys };
        });
      }),
    );
    expect(pragma.journal).toBe("wal");
    expect(pragma.fk).toBe(1);
    expect(existsSync(join(home, "blackboard.db"))).toBe(true);
  });

  test("creates all nine tables and reopening is a no-op", async () => {
    const home = fresh();
    const want = ["__drizzle_migrations", "agents", "blocks", "comments", "content_block_revs", "content_blocks", "documents", "reading_state", "reviews", "sqlite_sequence"];
    expect(await tables(home)).toEqual(want);
    // second open of the same home: same handle, same tables
    expect(await tables(home)).toEqual(want);
  });

  test("a database created before drizzle adopts the baseline and gains the new columns", async () => {
    const home = fresh();
    // Fake an old-shape database: comments/documents without the columns this round added.
    const { Database } = await import("bun:sqlite");
    const raw = new Database(join(home, "blackboard.db"));
    raw.run(`CREATE TABLE documents (id TEXT PRIMARY KEY, path TEXT, created_at TEXT NOT NULL, opened_at TEXT NOT NULL)`);
    raw.run(`CREATE TABLE comments (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, doc TEXT NOT NULL, anchor_kind TEXT NOT NULL, quote TEXT, body TEXT NOT NULL, images TEXT, author TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, status TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT, reopened_at TEXT, reopened_by TEXT, replies TEXT NOT NULL)`);
    raw.close();

    // First open through the layer: baseline applies (IF NOT EXISTS) and the ALTER pass backfills.
    const cols = await run(
      Effect.gen(function* () {
        const db = yield* Db;
        return yield* db.raw(home, (d) => ({
          comments: (d.query("SELECT name FROM pragma_table_info('comments')").all() as { name: string }[]).map((r) => r.name),
          documents: (d.query("SELECT name FROM pragma_table_info('documents')").all() as { name: string }[]).map((r) => r.name),
          contentBlocks: (d.query("SELECT name FROM sqlite_master WHERE type='table' AND name='content_blocks'").all() as { name: string }[]).length,
          applied: (d.query("SELECT created_at FROM __drizzle_migrations ORDER BY id").all() as { created_at: number }[]).length,
        }));
      }),
    );
    expect(cols.comments).toContain("block_id");
    expect(cols.comments).toContain("block_rev");
    expect(cols.documents).toContain("body_rev");
    expect(cols.contentBlocks).toBe(1);
    expect(cols.applied).toBeGreaterThan(0);
  });

  test("foreign keys reject an orphan comment", async () => {
    const home = fresh();
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const db = yield* Db;
        return yield* db.raw(home, (raw) =>
          raw.run(`INSERT INTO comments (id, document_id, doc, anchor_kind, body, author, created_at, status, replies) VALUES ('c_x', 'ghost', 'x.md', 'general', 'b', 'a', 't', 'open', '[]')`),
        );
      }).pipe(Effect.provide(layer)),
    );
    expect(result._tag).toBe("Failure");
  });
});

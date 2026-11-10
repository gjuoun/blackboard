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

  test("creates all six tables and reopening is a no-op", async () => {
    const home = fresh();
    const want = ["agents", "blocks", "comments", "documents", "reading_state", "reviews"];
    expect(await tables(home)).toEqual(want);
    // second open of the same home: same handle, same tables
    expect(await tables(home)).toEqual(want);
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

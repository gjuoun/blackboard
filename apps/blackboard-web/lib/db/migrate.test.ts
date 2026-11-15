import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Db, layer as dbLayer } from "./client";
import { layer as lockLayer, Lock } from "../lock";
import { migrate, stats } from "./migrate";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-mig-")));

const run = <A>(effect: Effect.Effect<A, unknown, Db | Lock>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(dbLayer), Effect.provide(lockLayer)));

/** The four JSON stores, seeded the way real sessions produce them. */
const seed = (home: string) => {
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(
    join(home, "sessions.json"),
    JSON.stringify({
      version: 1,
      sessions: [
        { id: "abc123", path: "/docs/a.md", createdAt: "2026-11-01T00:00:00Z", openedAt: "2026-11-02T00:00:00Z" },
        { id: "def456", path: "/docs/b.md", createdAt: "2026-11-01T00:00:00Z", openedAt: "2026-11-01T00:00:00Z" },
      ],
    }),
  );
  mkdirSync(join(home, "sessions", "abc123"), { recursive: true });
  writeFileSync(
    join(home, "sessions", "abc123", "comments.json"),
    JSON.stringify({
      version: 1,
      docs: {
        "a.md": [
          { id: "c_1", quote: { exact: "e", prefix: "p", suffix: "s" }, body: "q?", author: "jun", createdAt: "2026-11-02T00:00:00Z", status: "open", replies: [{ id: "r_1", body: "a!", author: "agent", createdAt: "2026-11-02T01:00:00Z" }] },
          { id: "c_2", general: true, body: "g", author: "jun", createdAt: "2026-11-02T02:00:00Z", status: "resolved", resolvedAt: "2026-11-02T03:00:00Z", resolvedBy: "jun", replies: [] },
        ],
      },
      reviews: [{ id: "v_1", doc: "a.md", round: 1, body: "done", author: "agent", createdAt: "2026-11-02T04:00:00Z", verdict: "commented" }],
    }),
  );
  // a closed session: comments survive without a registry row
  mkdirSync(join(home, "sessions", "dead999"), { recursive: true });
  writeFileSync(
    join(home, "sessions", "dead999", "comments.json"),
    JSON.stringify({
      version: 1,
      docs: { "gone.md": [{ id: "c_3", general: true, body: "left", author: "jun", createdAt: "2026-11-01T00:00:00Z", status: "open", replies: [] }] },
    }),
  );
  writeFileSync(
    join(home, "reading-state.json"),
    JSON.stringify({ version: 1, docs: { abc123: { status: "reading", progress: 0.4, readAt: "2026-11-02T00:00:00Z", sourceMtime: 5 } } }),
  );
  writeFileSync(
    join(home, "agents.json"),
    JSON.stringify({
      version: 1,
      agents: [{ session: "def456", path: "/docs/b.md", piSession: "pi-1", url: "http://127.0.0.1:9", boundAt: "2026-11-01T00:00:00Z", lastSeenAt: "2026-11-01T00:00:00Z" }],
    }),
  );
};

describe("migrate", () => {
  test("dry-run reports counts and touches nothing on disk", async () => {
    const home = fresh();
    seed(home);
    const r = await run(migrate(home, { dry: true }));
    expect(r.dry).toBe(true);
    expect(r.documents).toBe(3); // two registry rows + one closed-session stub
    expect(r.comments).toBe(3);
    expect(r.reviews).toBe(1);
    expect(r.readingState).toBe(1);
    expect(r.agents).toBe(1);
    expect(r.renamed).toEqual([]);
    expect(existsSync(join(home, "sessions.json"))).toBe(true);
    expect(existsSync(join(home, "blackboard.db"))).toBe(false);
  });

  test("real run lands rows, renames sources, and a second run reports nothing", async () => {
    const home = fresh();
    seed(home);
    const r = await run(migrate(home));
    expect(r.documents).toBe(3);
    expect(r.comments).toBe(3);
    expect(r.renamed.length).toBe(5); // sessions.json, 2 comments.json, reading-state.json, agents.json
    expect(existsSync(join(home, "sessions.json.migrated"))).toBe(true);
    expect(existsSync(join(home, "sessions.json"))).toBe(false);

    const st = await run(stats(home));
    expect(st.tables.documents).toBe(3);
    expect(st.tables.comments).toBe(3);
    expect(st.tables.reviews).toBe(1);
    expect(st.tables.reading_state).toBe(1);
    expect(st.tables.agents).toBe(1);
    expect(st.tables.blocks).toBe(0);
    expect(st.bytes).toBeGreaterThan(0);

    // row content survived: replies JSON, quote anchor, closed-session stub
    const c = await run(
      Effect.gen(function* () {
        const db = yield* Db;
        return yield* db.raw(home, (raw) => raw.query("SELECT * FROM comments WHERE id='c_1'").get()!);
      }),
    );
    expect(JSON.parse(c.replies as string)).toHaveLength(1);
    const again = await run(migrate(home));
    expect(again.nothing).toBe(true);
    expect(again.renamed).toEqual([]);
  });

  test("corrupt JSON fails the run and renames nothing", async () => {
    const home = fresh();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "sessions.json"), "{not json");
    const exit = await Effect.runPromiseExit(migrate(home).pipe(Effect.provide(dbLayer), Effect.provide(lockLayer)));
    expect(exit._tag).toBe("Failure");
    expect(existsSync(join(home, "sessions.json.migrated"))).toBe(false);
    expect(existsSync(join(home, "sessions.json"))).toBe(true);
  });
});

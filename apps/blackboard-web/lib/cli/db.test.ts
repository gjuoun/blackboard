import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, setup } from "../../test/fixtures/cli";

/** Seed the JSON stores the way a pre-migration home looks, then run db commands against them. */
const seedJson = (home: string, docs: string, design: string) => {
  const id = createHash("sha1").update(design).digest("hex").slice(0, 10);
  mkdirSync(join(home, "sessions", id), { recursive: true });
  writeFileSync(
    join(home, "sessions.json"),
    JSON.stringify({ version: 1, sessions: [{ id, path: design, createdAt: "2026-11-10T00:00:00Z", openedAt: "2026-11-10T00:00:00Z" }] }),
  );
  writeFileSync(
    join(home, "sessions", id, "comments.json"),
    JSON.stringify({
      version: 1,
      docs: {
        "design.md": [
          { id: "c_aaaaaaaaaaaa", general: true, body: "a note", author: "agent", createdAt: "2026-11-10T00:00:00Z", status: "open", replies: [] },
        ],
      },
    }),
  );
  writeFileSync(
    join(home, "reading-state.json"),
    JSON.stringify({ version: 1, docs: { [id]: { status: "reading", progress: 0.4, readAt: "2026-11-10T00:00:00Z", sourceMtime: 5 } } }),
  );
  return id;
};

describe("blackboard db", () => {
  test("stats on a fresh home, migrate --dry-run, migrate, stats again, bogus sub exits 2", () => {
    const { home, docs, design } = setup();
    seedJson(home, docs, design);

    const empty = runCli(home, ["db", "stats"]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("documents: 0");

    const dry = runCli(home, ["db", "migrate", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would migrate");
    expect(dry.out).toContain("1 documents");
    expect(dry.out).toContain("1 comments");
    // dry-run touched nothing: the JSON sources stay, the real db gets no rows.
    expect(existsSync(join(home, "sessions.json"))).toBe(true);
    expect(existsSync(join(home, "sessions.json.migrated"))).toBe(false);

    const real = runCli(home, ["db", "migrate"]);
    expect(real.code).toBe(0);
    expect(real.out).toContain("migrated: 1 documents, 1 comments, 0 reviews, 1 reading_state, 0 agents");
    expect(existsSync(join(home, "sessions.json.migrated"))).toBe(true);
    expect(existsSync(join(home, "blackboard.db"))).toBe(true);

    const full = runCli(home, ["db", "stats"]);
    expect(full.code).toBe(0);
    expect(full.out).toContain("documents: 1");
    expect(full.out).toContain("comments: 1");
    expect(full.out).toContain("reading_state: 1");

    const again = runCli(home, ["db", "migrate"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("nothing to migrate");

    const bogus = runCli(home, ["db", "bogus"]);
    expect(bogus.code).toBe(2);
  }, 30_000);
});

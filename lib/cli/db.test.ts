import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, setup } from "../../test/fixtures/cli";

/** Seed the JSON stores the way `open`/`comment` do, then run db commands against them. */
const seedJson = (home: string, docs: string) => {
  mkdirSync(join(home, "sessions"), { recursive: true });
  const opened = runCli(home, ["open", "--no-browser", "--no-server", "design.md"], docs);
  const id = opened.out.trim().split(/\s+/)[0];
  runCli(home, ["comment", "design.md", "--general", "a note"], docs);
  writeFileSync(
    join(home, "reading-state.json"),
    JSON.stringify({ version: 1, docs: { [id]: { status: "reading", progress: 0.4, readAt: "2026-11-10T00:00:00Z", sourceMtime: 5 } } }),
  );
  return id;
};

describe("blackboard db", () => {
  test("stats on a fresh home, migrate --dry-run, migrate, stats again, bogus sub exits 2", () => {
    const { home, docs } = setup();
    seedJson(home, docs);

    const empty = runCli(home, ["db", "stats"]);
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("documents: 0");

    const dry = runCli(home, ["db", "migrate", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would migrate");
    expect(dry.out).toContain("1 documents");
    expect(dry.out).toContain("1 comments");
    // dry-run touched the JSON stores, not them (blackboard.db exists already — `db stats` opened it)
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

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Comment } from "./comments-store";
import { readComments } from "./comments-store";
import { importBoards } from "./import";
import { listSessions, sessionCommentsPath } from "./sessions";

const c = (id: string, body: string): Comment => ({
  id,
  quote: { exact: "x", prefix: "", suffix: "" },
  body,
  author: "jun",
  createdAt: "2026-10-01T00:00:00.000Z",
  status: "open",
  replies: [],
});

/** An old-style root: board "alpha" with comments on two docs, one deleted doc and one escape; "beta" with none. */
function legacy() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-import-")));
  const root = join(base, "root");
  const home = join(base, "home");
  mkdirSync(join(root, "alpha", "research"), { recursive: true });
  mkdirSync(join(root, "alpha", ".blackboard"), { recursive: true });
  mkdirSync(join(root, "beta"), { recursive: true });
  mkdirSync(join(root, ".hidden", ".blackboard"), { recursive: true });
  writeFileSync(join(root, "alpha", "design.md"), "# Design\n");
  writeFileSync(join(root, "alpha", "research", "notes.md"), "# Notes\n");
  writeFileSync(join(base, "outside.md"), "# Outside\n");
  writeFileSync(join(root, "beta", "brief.md"), "# Brief\n");
  const legacyFile = join(root, "alpha", ".blackboard", "comments.json");
  writeFileSync(
    legacyFile,
    JSON.stringify({
      version: 1,
      docs: {
        "design.md": [c("c_1", "one"), c("c_2", "two")],
        "research/notes.md": [c("c_3", "three")],
        "gone.md": [c("c_4", "four")],
        "../../outside.md": [c("c_5", "five")],
        "empty.md": [],
      },
    }),
  );
  writeFileSync(join(root, ".hidden", ".blackboard", "comments.json"), JSON.stringify({ version: 1, docs: { "x.md": [c("c_9", "nine")] } }));
  return { base, root, home, legacyFile };
}

describe("importBoards", () => {
  test("registers each commented doc and copies its comments", async () => {
    const { root, home } = legacy();
    const r = await importBoards(home, root);
    expect({ imported: r.imported, sessions: r.sessions, skipped: r.skipped.length }).toEqual({ imported: 3, sessions: 2, skipped: 2 });
    const byName = Object.fromEntries(listSessions(home).map((s) => [s.path.split("/").at(-1), s]));
    expect(Object.keys(byName).sort()).toEqual(["design.md", "notes.md"]);
    const design = readComments(sessionCommentsPath(home, byName["design.md"].id));
    expect(design.docs["design.md"].map((x) => x.body)).toEqual(["one", "two"]);
    const notes = readComments(sessionCommentsPath(home, byName["notes.md"].id));
    expect(notes.docs["notes.md"].map((x) => x.id)).toEqual(["c_3"]);
  });

  test("skips a doc that no longer exists and a key that leaves the board", async () => {
    const { root, home } = legacy();
    const r = await importBoards(home, root);
    expect(r.skipped.map((s) => `${s.doc}: ${s.reason}`).sort()).toEqual([
      "alpha/../../outside.md: outside its board",
      "alpha/gone.md: doc no longer exists",
    ]);
  });

  test("re-running imports nothing new", async () => {
    const { root, home } = legacy();
    await importBoards(home, root);
    const again = await importBoards(home, root);
    expect(again.imported).toBe(0);
    expect(again.skipped.filter((s) => s.reason === "session already has comments")).toHaveLength(2);
    const design = listSessions(home).find((s) => s.path.endsWith("design.md"))!;
    expect(readComments(sessionCommentsPath(home, design.id)).docs["design.md"]).toHaveLength(2);
  });

  test("dry run writes nothing and leaves the old file alone", async () => {
    const { root, home, legacyFile } = legacy();
    const before = readFileSync(legacyFile, "utf8");
    const r = await importBoards(home, root, { dryRun: true });
    expect({ imported: r.imported, sessions: r.sessions }).toEqual({ imported: 3, sessions: 2 });
    expect(existsSync(join(home, "sessions.json"))).toBe(false);
    expect(existsSync(join(home, "sessions"))).toBe(false);
    await importBoards(home, root);
    expect(readFileSync(legacyFile, "utf8")).toBe(before);
  });
});

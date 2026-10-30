import { describe, expect, test } from "bun:test";
import type { DiffSnapshot } from "./diff-index";
import { anchorLabel, codeState, currentLine, groupCodeThreads, normalizeCodeAnchor, rowKey, threadKey, type CodeAnchor } from "./code-anchor";

const anchor = (over: Partial<CodeAnchor> = {}): CodeAnchor => ({
  path: "lib/residency.ts",
  startLine: 3,
  endLine: 3,
  side: "new",
  lineText: "  return gate;",
  ...over,
});

/** A snapshot that reads each path once (like the real one) and counts those reads. */
function snapshot(lines: readonly string[] | null, over: Partial<DiffSnapshot> = {}) {
  let reads = 0;
  let cached: readonly string[] | null | undefined;
  const snap: DiffSnapshot = {
    root: "/repo",
    baseRef: "main",
    baseSha: "abc1234",
    files: [],
    totals: { files: 0, additions: 0, deletions: 0 },
    file: () => undefined,
    content: () => {
      if (cached === undefined) {
        reads += 1;
        cached = lines;
      }
      return cached;
    },
    ...over,
  };
  return { snap, reads: () => reads };
}

describe("code thread grouping", () => {
  const rendered = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    code: { path: "lib/residency.ts", startLine: 3, endLine: 3, side: "new" as const, lineText: "  return gate;" },
    body: "note " + id,
    html: "<p>note " + id + "</p>",
    author: "jun",
    createdAt: "2026-10-29T12:00:0" + id.slice(-1) + ".000Z",
    status: "open" as const,
    replies: [],
    ...over,
  });

  test("comments on the same line become one row with a count, replies included", () => {
    const { snap } = snapshot(["export function residency() {", "  const gate = 1;", "  return gate;"]);
    const { byRow, state } = groupCodeThreads(
      [
        rendered("c_1", { replies: [{ id: "r_1", body: "because it caps", author: "agent", createdAt: "2026-10-29T12:01:00.000Z", html: "<p>because it caps</p>" }] }),
        rendered("c_2"),
      ],
      snap,
    );
    const list = byRow.get(threadKey("lib/residency.ts", "L3")) ?? [];
    expect(list.map((t) => t.id)).toEqual(["c_1", "c_2"]);
    expect(list[0].count).toBe(2);
    expect(list[0].entries.map((e) => e.reply)).toEqual([false, true]);
    expect(state.c_1).toEqual({ orphaned: false, movedTo: null });
  });

  test("a quote-anchored comment is left out of the diff grouping", () => {
    const { snap } = snapshot(["a"]);
    const { byRow, state } = groupCodeThreads([rendered("c_1", { code: undefined, quote: { exact: "a", prefix: "", suffix: "" } })], snap);
    expect(byRow.size).toBe(0);
    expect(state).toEqual({});
  });

  test("the same line in two files stays two threads", () => {
    const { snap } = snapshot(["a"]);
    const { byRow } = groupCodeThreads(
      [rendered("c_1"), rendered("c_2", { code: { path: "lib/other.ts", startLine: 3, endLine: 3, side: "new" as const, lineText: "x" } })],
      snap,
    );
    expect([...byRow.keys()].sort()).toEqual([threadKey("lib/other.ts", "L3"), threadKey("lib/residency.ts", "L3")].sort());
  });
});

describe("code anchor", () => {
  test("normalizes a structured anchor and defaults the range end and side", () => {
    expect(normalizeCodeAnchor({ path: "./lib/a.ts", startLine: 12, lineText: "x" })).toEqual({
      path: "lib/a.ts",
      startLine: 12,
      endLine: 12,
      side: "new",
      lineText: "x",
    });
    expect(normalizeCodeAnchor({ path: "lib/a.ts", startLine: 2, endLine: 5, side: "old", lineText: "" })).toMatchObject({
      endLine: 5,
      side: "old",
    });
  });

  test("rejects an escaped path, a bad line, a reversed range, an unknown side and an oversized text", () => {
    const base = { path: "lib/a.ts", startLine: 1, lineText: "x" };
    expect(normalizeCodeAnchor({ ...base, path: "/etc/passwd" })).toBeNull();
    expect(normalizeCodeAnchor({ ...base, path: "../outside.ts" })).toBeNull();
    expect(normalizeCodeAnchor({ ...base, startLine: 0 })).toBeNull();
    expect(normalizeCodeAnchor({ ...base, startLine: 3, endLine: 2 })).toBeNull();
    expect(normalizeCodeAnchor({ ...base, side: "both" })).toBeNull();
    expect(normalizeCodeAnchor({ ...base, lineText: "x".repeat(4001) })).toBeNull();
    expect(normalizeCodeAnchor(null)).toBeNull();
  });

  test("the row key and the label name the rendered row and the CLI anchor", () => {
    expect(rowKey(anchor())).toBe("L3");
    expect(rowKey(anchor({ side: "old", startLine: 34 }))).toBe("Lold34");
    expect(anchorLabel(anchor())).toBe("lib/residency.ts:L3");
  });

  test("an unchanged line is intact and one content read is enough", () => {
    const { snap, reads } = snapshot(["export function residency() {", "  const gate = 1;", "  return gate;", "}"]);
    expect(currentLine(anchor(), snap)).toBe("  return gate;");
    expect(codeState(anchor(), snap)).toEqual({ orphaned: false, movedTo: null });
    expect(reads()).toBe(1);
  });

  test("a drifted line reports the one place its text moved to", () => {
    const { snap } = snapshot(["export function residency() {", "  // drifted", "  const gate = 1;", "  return gate;", "}"]);
    expect(codeState(anchor(), snap)).toEqual({ orphaned: true, movedTo: 4 });
  });

  test("a text that is gone or repeated does not name a line", () => {
    expect(codeState(anchor(), snapshot(["a", "b", "c"]).snap)).toEqual({ orphaned: true, movedTo: null });
    expect(codeState(anchor({ startLine: 1 }), snapshot(["drifted", "x", "  return gate;", "  return gate;"]).snap)).toEqual({ orphaned: true, movedTo: null });
    expect(codeState(anchor(), snapshot(null).snap)).toEqual({ orphaned: true, movedTo: null });
  });

  test("an old-side anchor is checked against the deleted hunk line", () => {
    const line = { kind: "del" as const, text: "  return gate;", oldLine: 3, newLine: null };
    const { snap } = snapshot(null, {
      file: () => ({ path: "lib/residency.ts", oldPath: null, status: "modified", additions: 0, deletions: 1, binary: false, hunks: [{ header: "", oldStart: 3, oldLines: 1, newStart: 3, newLines: 0, lines: [line] }] }),
    });
    expect(codeState(anchor({ side: "old" }), snap)).toEqual({ orphaned: false, movedTo: null });
    expect(codeState(anchor({ side: "old", lineText: "was different" }), snap)).toEqual({ orphaned: true, movedTo: null });
  });
});

import { describe, expect, test } from "bun:test";
import { rowKey, threadKey, type CodeThread } from "./code-anchor";
import type { DiffFile, DiffHunk, DiffSnapshot } from "./diff-index";
import { renderFileDiff, renderSnippet } from "./snippet";

const add = (text: string, newLine: number) => ({ kind: "add" as const, text, oldLine: null, newLine });
const del = (text: string, oldLine: number) => ({ kind: "del" as const, text, oldLine, newLine: null });
const ctx = (text: string, oldLine: number, newLine: number) => ({ kind: "ctx" as const, text, oldLine, newLine });

const HUNK: DiffHunk = {
  header: "export function render()",
  oldStart: 3,
  oldLines: 6,
  newStart: 3,
  newLines: 7,
  lines: [
    ctx("line 3", 3, 3),
    del("line 4", 4),
    del("line 5", 5),
    add("line 4 changed", 4),
    add("line 5 added", 5),
    add("line 6 added", 6),
    ctx("line 7", 6, 7),
    ctx("line 8", 7, 8),
    ctx("line 9", 8, 9),
  ],
};

const CONTENT = Array.from({ length: 40 }, (_, i) => "line " + (i + 1));

function file(over: Partial<DiffFile> = {}): DiffFile {
  return { path: "lib/a.ts", oldPath: null, status: "modified", additions: 3, deletions: 2, binary: false, hunks: [HUNK], ...over };
}

function snapshot(files: DiffFile[], content: Record<string, readonly string[]> | null = { "lib/a.ts": CONTENT }): DiffSnapshot {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    root: "/repo",
    baseRef: "main",
    baseSha: "abc1234",
    files,
    totals: { files: files.length, additions: 8, deletions: 2 },
    file: (p) => byPath.get(p),
    content: (p) => content?.[p] ?? null,
  };
}

describe("range snippet", () => {
  test("shows added and deleted rows, anchors, and the in-range counts", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 });
    expect(s.state).toBe("ok");
    expect(s.range).toEqual({ start: 1, end: 20 });
    expect(s.additions).toBe(3);
    expect(s.deletions).toBe(2);
    expect(s.html).toContain('class="dl add inr" id="L4"');
    expect(s.html).toContain('class="dl del inr" id="Lold4"');
    expect(s.html).toContain('class="dl ctx inr" id="L1"');
    expect(s.html).toContain('data-testid="snippet-lines"');
  });

  test("folds a long unchanged span but keeps both edges", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 });
    expect(s.html).toContain('class="dl fold"');
    expect(s.html).toContain("L9-L18 unchanged, folded");
    expect(s.html).toContain('id="L8"');
    expect(s.html).toContain('id="L19"');
    expect(s.html).not.toContain('id="L10"');
  });

  test("a reversed range normalizes and an oversized range clamps to the file", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 200, end: 100 });
    expect(s.range).toEqual({ start: 40, end: 40 });
    expect(s.html).toContain('id="L40"');
  });

  test("a deleted file renders its removed lines instead of throwing", () => {
    const deleted: DiffFile = {
      path: "docs/gone.md",
      oldPath: null,
      status: "deleted",
      additions: 0,
      deletions: 2,
      binary: false,
      hunks: [{ header: "", oldStart: 2, oldLines: 2, newStart: 0, newLines: 0, lines: [del("old two", 2), del("old three", 3)] }],
    };
    const s = renderSnippet(snapshot([deleted], null), "docs/gone.md", { start: 2, end: 3 });
    expect(s.state).toBe("deleted");
    expect(s.deletions).toBe(2);
    expect(s.html).toContain('class="dl del inr" id="Lold2"');
  });

  test("an unchanged path and a binary file give stable states", () => {
    const unchanged = renderSnippet(snapshot([file()]), "README.md", { start: 1, end: 5 });
    expect(unchanged.state).toBe("unchanged");
    expect(unchanged.html).toContain("No local change for this file.");
    const binary = renderSnippet(snapshot([file({ binary: true })]), "lib/a.ts", { start: 1, end: 5 });
    expect(binary.state).toBe("binary");
    expect(binary.html).toContain("Binary file");
  });
});

const thread = (over: Partial<CodeThread> = {}): CodeThread => ({
  id: "c_1",
  anchor: { path: "lib/a.ts", startLine: 4, endLine: 4, side: "new", lineText: "line 4 changed" },
  author: "jun",
  createdAt: "2026-10-29T12:00:00.000Z",
  status: "open",
  orphaned: false,
  movedTo: null,
  count: 2,
  entries: [
    { id: "c_1", author: "jun", createdAt: "2026-10-29T12:00:00.000Z", html: "<p>why here?</p>", body: "why here?", reply: false },
    { id: "r_1", author: "agent", createdAt: "2026-10-29T12:05:00.000Z", html: "<p>because</p>", body: "because", reply: true },
  ],
  ...over,
});

const lookup = (...threads: CodeThread[]) =>
  new Map(threads.map((t) => [threadKey(t.anchor.path, rowKey(t.anchor)), threads.filter((x) => x.anchor.path === t.anchor.path && rowKey(x.anchor) === rowKey(t.anchor))]));

describe("code comment threads", () => {
  test("a thread renders immediately after its anchor row inside the same diff box", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 }, lookup(thread()));
    expect(s.html).toContain('class="dl add inr cmt" id="L4"');
    const row = s.html.indexOf('id="L4"');
    const block = s.html.indexOf('data-testid="code-thread"');
    expect(block).toBeGreaterThan(row);
    expect(block).toBeLessThan(s.html.indexOf('id="L5"'));
    expect(s.html).toContain('data-anchor="L4"');
    expect(s.html).toContain('data-testid="code-count">2</span>');
    expect(s.html).toContain("<p>why here?</p>");
    expect(s.html).toContain("<p>because</p>");
    expect(s.html).toContain("Resolve conversation");
  });

  test("every real line row carries the entry, and hunk or folded rows carry none", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 });
    const rows = (s.html.match(/class="dl (?:add|del|ctx)[^"]*"/g) ?? []).length;
    const entries = (s.html.match(/data-testid="code-add"/g) ?? []).length;
    expect(entries).toBe(rows);
    const folded = s.html.slice(s.html.indexOf('class="dl fold"'), s.html.indexOf("</div>", s.html.indexOf('class="dl fold"')));
    expect(folded).not.toContain("code-add");
    expect(folded).not.toContain("code-count");
  });

  test("an orphaned thread shows the warn badge and the line its text moved to", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 }, lookup(thread({ orphaned: true, movedTo: 6 })));
    expect(s.html).toContain('class="cc-thread orphan"');
    expect(s.html).toContain("L4 \u21a6 \u73b0 L6");
  });

  test("an old-side anchor hangs from the deleted row", () => {
    const old = thread({ anchor: { path: "lib/a.ts", startLine: 4, endLine: 4, side: "old", lineText: "line 4" } });
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 }, lookup(old));
    expect(s.html).toContain('class="dl del inr cmt" id="Lold4"');
    expect(s.html).toContain('data-anchor="Lold4"');
  });

  test("a thread for another file or another line is not rendered", () => {
    const otherFile = thread({ anchor: { path: "lib/b.ts", startLine: 4, endLine: 4, side: "new", lineText: "x" } });
    const otherLine = thread({ anchor: { path: "lib/a.ts", startLine: 9, endLine: 9, side: "new", lineText: "line 9" } });
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 }, lookup(otherFile, otherLine));
    expect(s.html).not.toContain('data-testid="code-thread"');
    expect(s.html).not.toContain('data-testid="code-count"');
  });

  test("a resolved thread keeps its block and offers to reopen", () => {
    const s = renderSnippet(snapshot([file()]), "lib/a.ts", { start: 1, end: 20 }, lookup(thread({ status: "resolved" })));
    expect(s.html).toContain('class="cc-thread resolved"');
    expect(s.html).toContain("Reopen conversation");
  });

  test("the whole-file diff renders the same thread after its row", () => {
    const d = renderFileDiff(snapshot([file()]), "lib/a.ts", lookup(thread()));
    expect(d.html).toContain('id="L4"');
    expect(d.html.indexOf('data-testid="code-thread"')).toBeGreaterThan(d.html.indexOf('id="L4"'));
  });
});

describe("whole-file diff", () => {
  test("renders hunk headers, both sides and line numbers", () => {
    const d = renderFileDiff(snapshot([file()]), "lib/a.ts");
    expect(d.state).toBe("ok");
    expect(d.additions).toBe(3);
    expect(d.deletions).toBe(2);
    expect(d.html).toContain("@@ -3,6 +3,7 @@ export function render()");
    expect(d.html).toContain('class="dl add" id="L4"');
    expect(d.html).toContain('class="dl del" id="Lold4"');
    expect(d.html).toContain('class="dl hunk"');
  });

  test("an unknown path is a state, not an error", () => {
    expect(renderFileDiff(snapshot([file()]), "nope.md")).toMatchObject({ state: "unchanged", additions: 0, deletions: 0 });
  });
});

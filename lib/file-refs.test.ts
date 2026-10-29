import { describe, expect, test } from "bun:test";
import type { DiffFile, DiffSnapshot } from "./diff-index";
import { fileHref, normalizeRange, parseFileRef, parseSelectedFile, prListHref, tabHref } from "./file-refs";
import { renderMarkdown } from "./markdown";

const file = (path: string, over: Partial<DiffFile> = {}): DiffFile => ({
  path,
  oldPath: null,
  status: "modified",
  additions: 3,
  deletions: 1,
  binary: false,
  hunks: [],
  ...over,
});

function snapshot(files: DiffFile[]): DiffSnapshot {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    root: "/repo",
    baseRef: "main",
    baseSha: "abc1234",
    files,
    totals: { files: files.length, additions: 0, deletions: 0 },
    file: (p) => byPath.get(p),
    content: () => null,
  };
}

const INDEX = () => snapshot([file("lib/a.ts"), file("docs/deleted.md", { status: "deleted" })]);

describe("parseFileRef", () => {
  test("explicit path with a range", () => {
    expect(parseFileRef("file:lib/a.ts:L3-L8")).toEqual({ path: "lib/a.ts", start: 3, end: 8 });
  });

  test("single line and path-only forms", () => {
    expect(parseFileRef("file:lib/a.ts:L12")).toEqual({ path: "lib/a.ts", start: 12, end: 12 });
    expect(parseFileRef("file:lib/a.ts")).toEqual({ path: "lib/a.ts", start: null, end: null });
  });

  test("a reversed range normalizes; the shorthand has no path", () => {
    expect(parseFileRef("file:L330-240")).toEqual({ path: null, start: 240, end: 330 });
    expect(parseFileRef("file:L12-L9")).toEqual({ path: null, start: 9, end: 12 });
  });

  test("non-file and unsafe links are left alone", () => {
    for (const href of ["https://x.test/a", "docs/a.md", "file:", "file:../secret.md", "file:/etc/passwd", "file:lib/a.ts:L0-L2"]) {
      expect({ href, out: parseFileRef(href) }).toEqual({ href, out: null });
    }
  });

  test("normalizeRange swaps and rejects zero", () => {
    expect(normalizeRange(9, 3)).toEqual({ start: 3, end: 9 });
    expect(normalizeRange(5, null)).toEqual({ start: 5, end: 5 });
    expect(normalizeRange(0, 3)).toBeNull();
  });
});

describe("session links", () => {
  test("file hrefs keep the tab and encoded path", () => {
    expect(fileHref("lib/a.ts", { start: 3, end: 8 })).toBe("?tab=pr&file=lib%2Fa.ts&L=L3-L8");
    expect(fileHref("lib/a.ts", { start: 3, end: 3 })).toBe("?tab=pr&file=lib%2Fa.ts&L=L3");
    expect(fileHref("lib/a.ts", null)).toBe("?tab=pr&file=lib%2Fa.ts");
    expect(prListHref()).toBe("?tab=pr");
    expect(tabHref("comments")).toBe("?tab=comments");
  });

  test("query parsing normalizes ranges and resolves the self shorthand", () => {
    expect(parseSelectedFile({ file: "lib/a.ts", L: "L8-L3" }, null)).toEqual({ path: "lib/a.ts", start: 3, end: 8 });
    expect(parseSelectedFile({ file: "L40-10" }, "docs/plan.md")).toEqual({ path: "docs/plan.md", start: 10, end: 40 });
    expect(parseSelectedFile({ file: "../escape.md" }, "docs/plan.md")).toBeNull();
    expect(parseSelectedFile({}, "docs/plan.md")).toBeNull();
  });
});

describe("renderMarkdown file links", () => {
  test("rewrites only markdown file links, with the range metadata", async () => {
    const src = "[start](file:lib/a.ts:L3-L8) and [self](file:L330-240) and [gone](file:docs/none.md)";
    const { html } = await renderMarkdown(src, { fileLinks: { index: INDEX(), docPath: "docs/deleted.md" } });
    expect(html).toContain('href="?tab=pr&#x26;file=lib%2Fa.ts&#x26;L=L3-L8"');
    expect(html).toContain('class="file-ref" data-file="lib/a.ts" data-range="L3-L8" title="lib/a.ts:L3-L8"');
    expect(html).toContain('href="?tab=pr&#x26;file=docs%2Fdeleted.md&#x26;L=L240-L330"');
    expect(html).toContain("file-ref-missing");
  });

  test("prose and fenced code never become links", async () => {
    const src = ["Prose file:lib/a.ts:L1-L2 stays text.", "", "```md", "[fenced](file:lib/a.ts:L1-L2)", "```", ""].join("\n");
    const { html } = await renderMarkdown(src, { fileLinks: { index: INDEX(), docPath: null } });
    expect(html).toContain("Prose file:lib/a.ts:L1-L2 stays text.");
    expect(html).toContain("file:lib/a.ts:L1-L2");
    expect(html).not.toContain("file-ref");
    expect(html).not.toContain("?tab=pr");
  });

  test("the selected link paints active, and raw HTML is not rendered", async () => {
    const { html } = await renderMarkdown("[x](file:lib/a.ts:L3-L8) <script>alert(1)</script>", {
      fileLinks: { index: INDEX(), docPath: null, selected: { path: "lib/a.ts", start: 3, end: 8 } },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("file-ref-active");
  });

  test("without file options the HTML is unchanged", async () => {
    const src = "[a](file:lib/a.ts:L3-L8)";
    const { html } = await renderMarkdown(src);
    expect(html).toContain('href="file:lib/a.ts:L3-L8"');
    expect(html).not.toContain("file-ref");
  });

  test("a render reads link metadata only, never file content", async () => {
    let contentCalls = 0;
    const base = INDEX();
    const guarded: DiffSnapshot = { ...base, content: () => ((contentCalls += 1), null) };
    await renderMarkdown("[a](file:lib/a.ts:L1-L2)", { fileLinks: { index: guarded, docPath: null } });
    expect(contentCalls).toBe(0);
  });

  test("a document outside git leaves the self shorthand alone", async () => {
    const { html } = await renderMarkdown("[a](file:L1-L2)", { fileLinks: { index: INDEX(), docPath: null } });
    expect(html).toContain('href="file:L1-L2"');
  });
});
describe("collected file references", () => {
  /** What the Local PR list filters on: the changed files the document itself opens. */
  test("valid references to changed files are collected once, even when repeated", async () => {
    const src = [
      "[range](file:lib/a.ts:L1-L2)",
      "[whole](file:lib/a.ts)",
      "[deleted](file:docs/deleted.md:L4)",
      "[self](file:L9-3)",
    ].join("\n");
    const { fileRefs } = await renderMarkdown(src, { fileLinks: { index: INDEX(), docPath: "docs/deleted.md" } });
    expect(fileRefs).toEqual(["docs/deleted.md", "lib/a.ts"]);
  });

  test("a reference the snapshot does not contain never enters the set", async () => {
    const { html, fileRefs } = await renderMarkdown("[gone](file:docs/none.md)", { fileLinks: { index: INDEX(), docPath: null } });
    expect(fileRefs).toEqual([]);
    expect(html).toContain("file-ref-missing");
  });

  test("prose, fenced code and an unresolvable shorthand collect nothing", async () => {
    const src = ["Prose file:lib/a.ts:L1-L2.", "", "```md", "[fenced](file:lib/a.ts:L1-L2)", "```", "", "[self](file:L1-L2)"].join("\n");
    const { fileRefs } = await renderMarkdown(src, { fileLinks: { index: INDEX(), docPath: null } });
    expect(fileRefs).toEqual([]);
  });

  test("a document with no file links answers with an empty set, never undefined", async () => {
    const { fileRefs } = await renderMarkdown("# Nothing\n\nPlain prose.", { fileLinks: { index: INDEX(), docPath: "lib/a.ts" } });
    expect(fileRefs).toEqual([]);
  });

  test("without file options nothing is collected", async () => {
    const { fileRefs } = await renderMarkdown("[a](file:lib/a.ts:L1-L2)");
    expect(fileRefs).toEqual([]);
  });
});

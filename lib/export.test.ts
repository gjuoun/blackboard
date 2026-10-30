import { describe, expect, test } from "bun:test";
import type { Comment } from "./comments-store";
import { exportComments } from "./export";

const base = { author: "jun", createdAt: "2026-10-16T10:00:00Z", replies: [] };
const comments: (Comment & { orphaned: boolean })[] = [
  { ...base, id: "c1", quote: { exact: "The cache is warm.", prefix: "", suffix: "" }, body: "Why warm?", status: "open", orphaned: false,
    replies: [{ id: "r1", body: "Preloaded at boot.", author: "agent", createdAt: "2026-10-16T10:05:00Z" }] },
  { ...base, id: "c2", quote: { exact: "Done already.", prefix: "", suffix: "" }, body: "resolved one", status: "resolved", orphaned: false },
  { ...base, id: "c3", quote: { exact: "Old line one\nold line two", prefix: "", suffix: "" }, body: "Still relevant?", status: "open", orphaned: true },
];

describe("exportComments", () => {
  const md = exportComments("Design", "/work/repo/docs/design.md", comments);

  test("starts with the doc's title, the open count and its file", () => {
    expect(md.split("\n")[0]).toBe("## Design — 2 open comments");
    expect(md.split("\n")[2]).toBe("File: `/work/repo/docs/design.md`");
  });

  test("quotes the passage, then the note, then replies", () => {
    expect(md).toContain("> The cache is warm.\n\n**jun:** Why warm?\n- **agent:** Preloaded at boot.");
  });

  test("leaves resolved comments out", () => {
    expect(md).not.toContain("resolved one");
  });

  test("marks orphaned comments and quotes every line of a multi-line passage", () => {
    expect(md).toContain("> Old line one\n> old line two\n\n_(passage no longer in the doc)_\n\n**jun:** Still relevant?");
  });

  test("a code-anchored comment exports its path:line instead of a quote", () => {
    const md = exportComments("Design", "/d.md", [
      { ...base, id: "c9", code: { path: "lib/residency.ts", startLine: 12, endLine: 12, side: "new", lineText: "  return gate;" }, body: "why the gate?", status: "open", orphaned: false },
    ]);
    expect(md).toContain("Anchored at `lib/residency.ts:L12`");
    expect(md).toContain("**jun:** why the gate?");
    expect(md).not.toContain("no longer in the doc");
  });

  test("a drifted code anchor says the line moved instead of calling it a lost passage", () => {
    const md = exportComments("Design", "/d.md", [
      { ...base, id: "c9", code: { path: "lib/residency.ts", startLine: 12, endLine: 12, side: "new", lineText: "  return gate;" }, body: "still here?", status: "open", orphaned: true },
    ]);
    expect(md).toContain("_(line drifted; anchored by its stored text)_");
    expect(md).not.toContain("passage no longer");
  });

  test("says so when nothing is open", () => {
    expect(exportComments("Design", "/d.md", [comments[1]])).toBe("## Design — no open comments\n\nFile: `/d.md`\n");
  });
});

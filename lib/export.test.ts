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
  const md = exportComments("demo", "design.md", comments);

  test("starts with the doc and the open count", () => {
    expect(md.split("\n")[0]).toBe("## demo/design.md — 2 open comments");
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

  test("says so when nothing is open", () => {
    expect(exportComments("demo", "design.md", [comments[1]])).toBe("## demo/design.md — no open comments\n");
  });
});

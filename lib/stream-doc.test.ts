import { describe, expect, test } from "bun:test";
import { exportStream, foldBlocks, nextN, type StreamBlock } from "./stream-doc";

/** A block literal with the fields a test does not care about filled in. */
const block = (n: number, body: string, over: Partial<StreamBlock> = {}): StreamBlock => ({
  id: `b_${n}`,
  n,
  action: "answer",
  author: "agent",
  body,
  at: "2026-11-10T10:00:00.000Z",
  ...over,
});

describe("nextN", () => {
  test("one for an empty stream, max+1 otherwise", () => {
    expect(nextN([])).toBe(1);
    expect(nextN([block(1, "a"), block(3, "b")])).toBe(4);
  });
});

describe("foldBlocks", () => {
  test("empty stream folds to empty", () => {
    expect(foldBlocks([])).toBe("");
  });

  test("answer and append extend the body, separated by a blank line", () => {
    const body = foldBlocks([
      block(1, "# Hello"),
      block(2, "next part", { action: "append" }),
      block(3, "last", { action: "answer" }),
    ]);
    expect(body).toBe("# Hello\n\nnext part\n\nlast\n");
  });

  test("edit carries the corrected whole document and replaces the view", () => {
    const body = foldBlocks([
      block(1, "old text"),
      block(2, "corrected whole", { action: "edit" }),
      block(3, "after", { action: "append" }),
    ]);
    expect(body).toBe("corrected whole\n\nafter\n");
  });

  test("an edit on an empty stream is just its body", () => {
    expect(foldBlocks([block(1, "whole", { action: "edit" })])).toBe("whole\n");
  });

  test("trailing whitespace on a block body is trimmed once", () => {
    expect(foldBlocks([block(1, "line\n\n\n")])).toBe("line\n");
  });
});

describe("exportStream", () => {
  test("one section per block, headed by label, author and time", () => {
    const out = exportStream([block(1, "first"), block(2, "second", { action: "edit", author: "jun" })], "标题");
    expect(out).toBe(
      "# 标题\n\n## 1. 长答 · agent · 2026-11-10T10:00:00.000Z\n\nfirst\n\n## 2. 改正文 · jun · 2026-11-10T10:00:00.000Z\n\nsecond\n",
    );
  });

  test("a writing block says so in its heading", () => {
    const out = exportStream([block(1, "draft", { status: "writing" })], "t");
    expect(out).toContain("## 1. 长答 · agent · 2026-11-10T10:00:00.000Z · writing");
  });

  test("an empty stream exports the title alone", () => {
    expect(exportStream([], "t")).toBe("# t\n");
  });
});

import { describe, expect, test } from "bun:test";
import { blockTitle, clip, TITLE_MAX_CHARS } from "./block-title";

describe("timeline title", () => {
  test("title: first heading wins", () => {
    expect(blockTitle({ n: 2, body: "Intro line\n\n### Why the rail changed\n\nbody" })).toBe("Why the rail changed");
  });

  test("title: without a heading, the first text line, stripped and clipped", () => {
    expect(blockTitle({ n: 2, body: "> **Quoted** `code` line\n\nmore" })).toBe("Quoted code line");
    const long = "x".repeat(60);
    expect(blockTitle({ n: 2, body: long })).toBe("x".repeat(TITLE_MAX_CHARS) + "…");
    expect(blockTitle({ n: 2, body: "- 列表第一项的文字" })).toBe("列表第一项的文字");
  });

  test("title: empty body falls back to the block number", () => {
    expect(blockTitle({ n: 3, body: "" })).toBe("第 3 块");
    expect(blockTitle({ n: 3, body: "\n   \n```\n```" })).toBe("第 3 块");
  });

  test("clip: counts characters, not bytes, and never splits a code point", () => {
    expect(clip("你好世界", 2)).toBe("你好…");
    expect(clip("a😀b", 2)).toBe("a😀…");
    expect(clip("short", 40)).toBe("short");
  });
});

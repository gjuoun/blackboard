import { describe, expect, test } from "bun:test";
import { allAdded, parseChangedLines } from "./file-view";

describe("file view", () => {
  test("file-view: changed lines from hunks", () => {
    // one modified line (old 6 -> new 6), one added line at new 20, one deletion with no new lines
    const diff = ["@@ -6 +6,2 @@", "-old", "+new", "+extra", "@@ -19,0 +20 @@", "+added", "@@ -30,2 +29,0 @@", "-gone"].join("\n");
    const { added, modified } = parseChangedLines(diff);
    expect([...modified].sort((a, b) => a - b)).toEqual([6, 7]);
    expect([...added]).toEqual([20]);
  });

  test("file-view: untracked file is all added", () => {
    const { added, modified } = allAdded(3);
    expect([...added].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(modified.size).toBe(0);
  });
});

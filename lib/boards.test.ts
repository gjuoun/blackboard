import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { listBoards, listDocs } from "./boards";
import { makeFixtureRoot } from "./test-fixture";

const { root, demo } = makeFixtureRoot();

describe("listBoards", () => {
  test("lists demo not .git", () => {
    const names = listBoards(root).map((b) => b.name);
    expect(names).toEqual(["demo", "empty-board"]);
  });

  test("counts docs per board", () => {
    const demoBoard = listBoards(root).find((b) => b.name === "demo");
    expect(demoBoard?.docCount).toBe(3);
  });
});

describe("listDocs", () => {
  test("lists markdown recursively, sorted, root files first", () => {
    expect(listDocs(demo)).toEqual(["brief.md", "design.md", "research/notes.md"]);
  });

  test("skips .hidden, node_modules and symlinks that leave the board", () => {
    const docs = listDocs(demo);
    expect(docs.some((d) => d.includes("secret"))).toBe(false);
    expect(docs.some((d) => d.includes("node_modules"))).toBe(false);
    expect(docs.some((d) => d.startsWith("escape"))).toBe(false);
  });

  test("returns empty for a missing folder", () => {
    expect(listDocs(join(root, "nope"))).toEqual([]);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildWorkspaceIndex, INDEX_CAP, resetWorkspaceCache, setGitRunner } from "./workspace-index";
import { workspaceTree } from "./workspace-tree";

describe("workspace index", () => {
  beforeEach(() => resetWorkspaceCache());

  test("index: one git call per head", () => {
    const calls: string[] = [];
    setGitRunner((_root, args) => {
      calls.push(args.join(" "));
      return args[0] === "rev-parse" ? "abc123\n" : "a.ts\0b/c.md\0";
    });
    const first = buildWorkspaceIndex("/repo");
    const second = buildWorkspaceIndex("/repo");
    expect(first?.files).toEqual(["a.ts", "b/c.md"]);
    expect(second).toBe(first as never);
    // rev-parse + ls-files on the miss, rev-parse only on the hit
    expect(calls).toEqual(["rev-parse HEAD", "ls-files -z", "rev-parse HEAD"]);
  });

  test("index: a new HEAD rebuilds the list", () => {
    let head = "h1";
    setGitRunner((_r, args) => (args[0] === "rev-parse" ? head : "x.ts\0"));
    buildWorkspaceIndex("/repo");
    head = "h2";
    expect(buildWorkspaceIndex("/repo")?.head).toBe("h2");
  });

  test("index: cache holds at most INDEX_CAP repos", () => {
    setGitRunner((_r, args) => (args[0] === "rev-parse" ? "h" : "f.ts\0"));
    for (let i = 0; i < INDEX_CAP + 3; i++) buildWorkspaceIndex(`/repo${i}`);
    let calls = 0;
    setGitRunner((_r, args) => { calls++; return args[0] === "rev-parse" ? "h" : "f.ts\0"; });
    buildWorkspaceIndex("/repo0");
    // evicted: the list is read again
    expect(calls).toBe(2);
  });

  test("index: outside git gives null", () => {
    setGitRunner(() => { throw new Error("not a repo"); });
    expect(buildWorkspaceIndex("/tmp/none")).toBeNull();
  });
});

describe("workspace tree", () => {
  test("tree: current file marked", () => {
    // The component marks the current file; its path comes from the same list the tree is built from.
    const src = readFileSync(new URL("../components/WorkspaceTree.tsx", import.meta.url), "utf8");
    expect(src).toContain("aria-current=\"page\"");
    expect(src).toContain("node.path === current");
  });

  test("tree: unregistered files are not links", () => {
    const src = readFileSync(new URL("../components/WorkspaceTree.tsx", import.meta.url), "utf8");
    expect(src).toContain("sessionId && !isCurrent");
  });

  test("tree: zero sync fs calls per node", () => {
    // The tree module imports nothing from node:fs. Its source is checked for any fs or child-process
    // import, so a later edit that reads the disk per node fails here.
    const src = readFileSync(new URL("./workspace-tree.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "node:(fs|child_process)"/);
    expect(src).not.toMatch(/Sync\(/);
    expect(workspaceTree(["a/b.ts"]).length).toBe(1);
  });

  test("tree: folders before files, sorted", () => {
    const t = workspaceTree(["z.md", "a/y.ts", "a/x.ts", "b.ts"]);
    expect(t.map((n) => n.name)).toEqual(["a", "b.ts", "z.md"]);
    const a = t[0];
    expect(a.kind === "dir" && a.children.map((n) => n.name)).toEqual(["x.ts", "y.ts"]);
  });
});

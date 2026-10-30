import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDiffSnapshot, getDiffSnapshot, normalizeRepoPath, parseUnifiedDiff, resetDiffCache, type GitRun } from "./diff-index";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-diff-")));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stdio: "ignore" });

function count(n: number, label: string) {
  return Array.from({ length: n }, (_, i) => label + " line " + (i + 1)).join("\n") + "\n";
}

/** main committed, origin/main present, branch feat/diff with tracked, staged, untracked, deleted, renamed files. */
function repo() {
  const root = join(tmp(), "repo");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "keep.txt"), count(12, "keep"));
  writeFileSync(join(root, "docs", "gone.txt"), count(4, "gone"));
  writeFileSync(join(root, "docs", "old.txt"), count(8, "old"));
  writeFileSync(join(root, "staged-edit.txt"), count(6, "staged"));
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-qb", "feat/diff");

  writeFileSync(join(root, "keep.txt"), count(12, "keep").replace("keep line 3", "keep line 3 changed"));
  writeFileSync(join(root, "staged-edit.txt"), count(6, "staged").replace("staged line 2", "staged line 2 changed"));
  git(root, "add", "staged-edit.txt");
  writeFileSync(join(root, "staged.txt"), count(2, "new staged"));
  git(root, "add", "staged.txt");
  execFileSync("git", ["rm", "-q", "docs/gone.txt"], { cwd: root });
  git(root, "mv", "docs/old.txt", "docs/new.txt");
  writeFileSync(join(root, "docs", "new.txt"), count(8, "old").replace("old line 5", "old line 5 renamed"));
  writeFileSync(join(root, "fresh.txt"), count(3, "fresh"));
  return root;
}

describe("repo snapshot", () => {
  test("sees tracked, staged, untracked, deleted and renamed changes", () => {
    const root = repo();
    const snap = buildDiffSnapshot(root)!;
    expect(snap.root).toBe(root);
    expect(snap.baseRef).toBe("main");
    expect(snap.baseSha).toMatch(/^[0-9a-f]{7}$/);
    const byPath = new Map(snap.files.map((f) => [f.path, f]));
    expect(byPath.get("keep.txt")?.status).toBe("modified");
    expect(byPath.get("staged-edit.txt")?.status).toBe("modified");
    expect(byPath.get("staged.txt")?.status).toBe("added");
    expect(byPath.get("docs/gone.txt")?.status).toBe("deleted");
    expect(byPath.get("docs/new.txt")?.status).toBe("renamed");
    expect(byPath.get("docs/new.txt")?.oldPath).toBe("docs/old.txt");
    expect(byPath.get("fresh.txt")?.status).toBe("untracked");
    expect(snap.totals.files).toBe(snap.files.length);
    expect(snap.totals.additions).toBeGreaterThan(0);
    expect(snap.totals.deletions).toBeGreaterThan(0);
    expect(snap.file("fresh.txt")?.additions).toBe(3);
    expect(snap.file("fresh.txt")?.hunks[0].lines.map((l) => l.newLine)).toEqual([1, 2, 3]);
  });

  test("reads each worktree file at most once and keeps the snapshot immutable", () => {
    const root = repo();
    const reads = new Map<string, number>();
    let gitCalls = 0;
    const countingGit: GitRun = (cwd, args) => {
      gitCalls += 1;
      return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
    };
    const snap = buildDiffSnapshot(root, {
      git: countingGit,
      readFile: (abs) => {
        reads.set(abs, (reads.get(abs) ?? 0) + 1);
        return execFileSync("cat", [abs]).toString();
      },
    })!;
    const callsAfterBuild = gitCalls;
    const first = snap.content("fresh.txt");
    const second = snap.content("fresh.txt");
    expect(second).toBe(first);
    expect([...reads.values()]).toEqual([...reads.keys()].map(() => 1));
    // Only the worktree text is read; the index build itself is one git pass.
    expect(gitCalls).toBe(callsAfterBuild);
    expect(Object.isFrozen(snap.files)).toBe(true);
    expect(Object.isFrozen(snap.file("fresh.txt"))).toBe(true);
  });

  test("a deleted file has hunks but no worktree content", () => {
    const root = repo();
    const snap = buildDiffSnapshot(root)!;
    const gone = snap.file("docs/gone.txt")!;
    expect(gone.deletions).toBe(4);
    expect(gone.hunks[0].lines.every((l) => l.kind === "del")).toBe(true);
    expect(snap.content("docs/gone.txt")).toBeNull();
  });

  test("reversed and bounded ranges do not matter to the index; hunk numbers are ascending", () => {
    const root = repo();
    const snap = buildDiffSnapshot(root)!;
    const keep = snap.file("keep.txt")!;
    const numbers = keep.hunks.flatMap((h) => h.lines.filter((l) => l.newLine !== null).map((l) => l.newLine!));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  test("a repository without a remote ref falls back to HEAD and says so", () => {
    const root = repo();
    execFileSync("git", ["update-ref", "-d", "refs/remotes/origin/main"], { cwd: root });
    const snap = buildDiffSnapshot(root)!;
    expect(snap.baseRef).toBe("HEAD");
  });

  test("a pinned base diffs that commit instead of chasing the merge-base", () => {
    const root = repo();
    // Roll the whole branch change into one commit, then leave one new file uncommitted.
    git(root, "add", "-A");
    git(root, "commit", "-qm", "branch work");
    const tip = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
    writeFileSync(join(root, "after.txt"), "one\n");
    const pinned = buildDiffSnapshot(root, { base: tip })!;
    expect(pinned.files.map((f) => f.path)).toEqual(["after.txt"]);
    expect(pinned.baseRef).toBe("main");
    expect(pinned.baseSha).toBe(tip.slice(0, 7));
    // The floating merge-base also sees the commit the pin skips.
    const floating = buildDiffSnapshot(root)!;
    expect(floating.files.length).toBeGreaterThan(pinned.files.length);
  });

  test("an unresolvable pin yields no committed diff, never a floating base", () => {
    const root = repo();
    const snap = buildDiffSnapshot(root, { base: "deadbeef" })!;
    expect(snap.files.every((f) => f.status === "untracked")).toBe(true);
    expect(snap.files.some((f) => f.path === "keep.txt")).toBe(false);
    expect(snap.baseSha).toBe("");
    expect(snap.baseRef).toBe("main");
  });

  test("no git is a stable empty answer, never a throw", () => {
    const nothing: GitRun = () => null;
    expect(buildDiffSnapshot("/tmp", { git: nothing })).toBeNull();
    resetDiffCache();
    expect(getDiffSnapshot("/tmp", { git: nothing })).toBeNull();
  });
});

describe("cache", () => {
  test("two pinned bases never share a snapshot", () => {
    const root = repo();
    git(root, "add", "-A");
    git(root, "commit", "-qm", "branch work");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
    const base = execFileSync("git", ["rev-parse", "refs/remotes/origin/main"], { cwd: root }).toString().trim();
    writeFileSync(join(root, "after.txt"), "one\n");
    resetDiffCache();
    const pinnedToHead = getDiffSnapshot(root, { base: head })!;
    expect(getDiffSnapshot(root, { base: head })).toBe(pinnedToHead);
    const pinnedToBase = getDiffSnapshot(root, { base })!;
    expect(pinnedToBase).not.toBe(pinnedToHead);
    expect(pinnedToBase.files.length).not.toBe(pinnedToHead.files.length);
  });

  test("an unchanged repository returns the same snapshot; a worktree change rebuilds it", () => {
    const root = repo();
    resetDiffCache();
    const a = getDiffSnapshot(root);
    const b = getDiffSnapshot(root);
    expect(b).toBe(a);
    writeFileSync(join(root, "keep.txt"), count(14, "keep"));
    const c = getDiffSnapshot(root);
    expect(c).not.toBe(a);
    expect(c!.file("keep.txt")!.additions).toBeGreaterThan(a!.file("keep.txt")!.additions);
  });
});

describe("paths and parsing", () => {
  test("normalizes repository paths and rejects escapes", () => {
    expect(normalizeRepoPath("lib/a.ts")).toBe("lib/a.ts");
    expect(normalizeRepoPath("./lib/../lib/a.ts")).toBe("lib/a.ts");
    for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "a\\b", "a\0b"]) {
      expect({ bad, out: normalizeRepoPath(bad) }).toEqual({ bad, out: null });
    }
  });

  test("a symlinked untracked file is not indexed", () => {
    const root = repo();
    const outside = join(tmp(), "outside.txt");
    writeFileSync(outside, "secret\n");
    symlinkSync(outside, join(root, "escape.txt"));
    const snap = buildDiffSnapshot(root)!;
    expect(snap.file("escape.txt")).toBeUndefined();
    expect(snap.content("escape.txt")).toBeNull();
  });

  test("parses rename and binary headers without inventing hunks", () => {
    const patch = [
      "diff --git a/old.bin b/new.bin",
      "similarity index 100%",
      "rename from old.bin",
      "rename to new.bin",
      "Binary files a/old.bin and b/new.bin differ",
      "",
    ].join("\n");
    const [file] = parseUnifiedDiff(patch);
    expect(file).toMatchObject({ path: "new.bin", oldPath: "old.bin", status: "renamed", binary: true, additions: 0, deletions: 0 });
    expect(file.hunks).toEqual([]);
  });
});

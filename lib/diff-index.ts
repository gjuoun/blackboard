/**
 * One repository snapshot per render request. The page builds it before markdown rendering and
 * hands the immutable index to the link visitor, so no visitor ever touches the filesystem or git.
 *
 * The diff base is the merge-base of HEAD and origin/main (falling back to HEAD when the remote
 * ref does not exist) unless a caller pins a commit: a document front matter does, so its diff
 * does not move when the branch moves. Either way the comparison is against the worktree:
 * tracked, staged and standard untracked files.
 */
import { lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gitRun, probe, readUtf8, untrackedPaths, type DiffOptions, type Probe } from "./diff-git";
import { parseUnifiedDiff, type DiffFile, type DiffHunk } from "./diff-parse";
import { normalizeRepoPath } from "./repo-path";

export type DiffTotals = { files: number; additions: number; deletions: number };

export type DiffSnapshot = {
  root: string;
  /** The label the base chip shows: "main" for a real merge-base, "HEAD" for the fallback. */
  baseRef: string;
  baseSha: string;
  files: readonly DiffFile[];
  totals: DiffTotals;
  file(path: string): DiffFile | undefined;
  /** Worktree lines of an indexed file, read at most once; null when absent, deleted, binary or too large. */
  content(path: string): readonly string[] | null;
};

const isBinary = (text: string) => text.includes("\0");
const linesOf = (text: string) => {
  if (text === "") return [] as string[];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

export function emptySnapshot(root: string): DiffSnapshot {
  const files: readonly DiffFile[] = [];
  const byPath = new Map<string, DiffFile>();
  return {
    root,
    baseRef: "HEAD",
    baseSha: "",
    files,
    totals: { files: 0, additions: 0, deletions: 0 },
    file: (p) => byPath.get(p),
    content: () => null,
  };
}

/** Absolute path inside the root for a normalized relative path, or null for a symlink/escape. */
function safeAbsolute(root: string, path: string): string | null {
  const rel = normalizeRepoPath(path);
  if (!rel) return null;
  const abs = join(root, rel);
  if (relative(root, abs).split(sep).join("/") !== rel) return null;
  try {
    if (lstatSync(abs).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return abs;
}

function assemble(probe: Probe, opts: DiffOptions): DiffSnapshot {
  const git = opts.git ?? gitRun;
  const read = opts.readFile ?? readUtf8;
  const root = probe.top;
  const patch = probe.base ? git(root, ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--unified=3", "-M", probe.base, "--", "."]) ?? "" : "";
  const byPath = new Map<string, DiffFile>();
  // Untracked text read while assembling the index is the same text a snippet may need; keep it
  // so one snapshot reads each file at most once.
  const preloaded = new Map<string, readonly string[] | null>();
  for (const file of parseUnifiedDiff(patch)) {
    const path = normalizeRepoPath(file.path);
    if (!path) continue;
    byPath.set(path, { ...file, path });
  }

  for (const path of untrackedPaths(probe.status)) {
    const abs = safeAbsolute(root, path);
    if (!abs) continue;
    const text = read(abs);
    if (text === null) continue;
    const lines = linesOf(text);
    if (isBinary(text)) {
      byPath.set(path, { path, oldPath: null, status: "untracked", additions: 0, deletions: 0, binary: true, hunks: [] });
      continue;
    }
    preloaded.set(path, lines);
    const hunk: DiffHunk = {
      header: "",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines: lines.map((line, i) => ({ kind: "add" as const, text: line, oldLine: null, newLine: i + 1 })),
    };
    byPath.set(path, { path, oldPath: null, status: "untracked", additions: lines.length, deletions: 0, binary: false, hunks: [hunk] });
  }

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    for (const hunk of file.hunks) {
      Object.freeze(hunk.lines);
      Object.freeze(hunk);
    }
    Object.freeze(file);
  }
  Object.freeze(files);
  const totals = files.reduce(
    (sum, f) => ({ files: sum.files + 1, additions: sum.additions + f.additions, deletions: sum.deletions + f.deletions }),
    { files: 0, additions: 0, deletions: 0 },
  );

  // Worktree text is read lazily and once per file. Nothing in this module reads during a tree walk.
  const cache = new Map<string, readonly string[] | null>();
  const content = (path: string): readonly string[] | null => {
    const key = normalizeRepoPath(path) ?? "";
    if (!key) return null;
    if (cache.has(key)) return cache.get(key) ?? null;
    const file = byPath.get(key);
    let value: readonly string[] | null = preloaded.get(key) ?? null;
    if (file && !file.binary && file.status !== "deleted" && !preloaded.has(key)) {
      const abs = safeAbsolute(root, key);
      const text = abs ? read(abs) : null;
      value = text === null || isBinary(text) ? null : linesOf(text);
    }
    cache.set(key, value);
    return value;
  };

  return {
    root,
    baseRef: probe.baseRef,
    baseSha: probe.base.slice(0, 7),
    files,
    totals,
    file: (p) => byPath.get(normalizeRepoPath(p) ?? ""),
    content,
  };
}

/** Build a snapshot without the module cache; the unit-test entry point. */
export function buildDiffSnapshot(root: string, opts: DiffOptions = {}): DiffSnapshot | null {
  const p = probe(root, opts.git ?? gitRun, opts.baseRef ?? "origin/main", opts.base);
  return p ? assemble(p, opts) : null;
}

const CACHE = new Map<string, { signature: string; snapshot: DiffSnapshot }>();
const CACHE_LIMIT = 8;

/** Drop the module cache (tests and a live-reload edge). */
export function resetDiffCache(): void {
  CACHE.clear();
}

/**
 * The cached snapshot for a repository root. A hit is keyed on HEAD, origin/main and the full
 * status output, so a new commit, a fetch or any worktree/index change rebuilds it; otherwise the
 * same immutable snapshot is reused across requests.
 */
export function getDiffSnapshot(root: string, opts: DiffOptions = {}): DiffSnapshot | null {
  const p = probe(root, opts.git ?? gitRun, opts.baseRef ?? "origin/main", opts.base);
  if (!p) return null;
  const hit = CACHE.get(p.top);
  if (hit?.signature === p.signature) return hit.snapshot;
  const snapshot = assemble(p, opts);
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  CACHE.set(p.top, { signature: p.signature, snapshot });
  return snapshot;
}
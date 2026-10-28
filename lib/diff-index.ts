import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

/**
 * One repository snapshot per render request. The page builds it before markdown rendering and
 * hands the immutable index to the link visitor, so no visitor ever touches the filesystem or git.
 *
 * The diff base is the merge-base of HEAD and origin/main (falling back to HEAD when the remote
 * ref does not exist), compared to the worktree: tracked, staged and standard untracked files.
 */

export type DiffStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";
export type DiffLineKind = "add" | "del" | "ctx";
export type DiffLine = { kind: DiffLineKind; text: string; oldLine: number | null; newLine: number | null };
export type DiffHunk = { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: readonly DiffLine[] };
export type DiffFile = {
  /** Normalized repository-relative path. For a rename this is the new path. */
  path: string;
  oldPath: string | null;
  status: DiffStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: readonly DiffHunk[];
};
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

/** git subprocess seam: unit tests inject a runner to count calls or simulate a missing git. */
export type GitRun = (cwd: string, args: string[]) => string | null;
/** file-read seam: unit tests inject a reader to prove each relevant file is read at most once. */
export type FileRead = (abs: string) => string | null;

export type DiffOptions = { git?: GitRun; readFile?: FileRead; baseRef?: string };

const GIT_TIMEOUT_MS = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;

const gitRun: GitRun = (cwd, args) => {
  try {
    return execFileSync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_PATCH_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    return null;
  }
};

const readUtf8: FileRead = (abs) => {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

/** A repository-relative path we are willing to expose: no absolute paths, no escapes, no NUL. */
export function normalizeRepoPath(path: string): string | null {
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path)) return null;
  const norm = posix.normalize(path).replace(/^\.\//, "");
  if (!norm || norm === "." || norm === ".." || norm.startsWith("../") || norm.startsWith("/")) return null;
  return norm;
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

const isBinary = (text: string) => text.includes("\0");
const linesOf = (text: string) => {
  if (text === "") return [] as string[];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

function emptySnapshot(root: string): DiffSnapshot {
  const files: readonly DiffFile[] = [];
  const byPath = new Map<string, DiffFile>();
  const cache = new Map<string, readonly string[] | null>();
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

type MutableFile = {
  path: string;
  oldPath: string | null;
  status: DiffStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
};

/** Parse a unified diff into per-file hunks. Paths come from the +++/--- or rename headers. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: MutableFile | null = null;
  let hunk: { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] } | null = null;
  let oldNo = 0;
  let newNo = 0;
  let newPath = "";
  let oldPath = "";

  const flush = () => {
    if (!cur) return;
    const path = newPath || oldPath;
    if (path) {
      files.push({
        path,
        oldPath: oldPath && oldPath !== path ? oldPath : null,
        status: cur.status,
        additions: cur.additions,
        deletions: cur.deletions,
        binary: cur.binary,
        hunks: cur.hunks,
      });
    }
    cur = null;
    hunk = null;
    newPath = "";
    oldPath = "";
  };

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      flush();
      cur = { path: "", oldPath: null, status: "modified", additions: 0, deletions: 0, binary: false, hunks: [] };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("@@ ")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (!m) {
        hunk = null;
        continue;
      }
      const next = {
        header: raw.replace(/^@@ [^@]*@@ ?/, "").trim(),
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [] as DiffLine[],
      };
      cur.hunks.push(next);
      hunk = next;
      oldNo = next.oldStart;
      newNo = next.newStart;
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("new file mode")) cur.status = "added";
      else if (raw.startsWith("deleted file mode")) cur.status = "deleted";
      else if (raw.startsWith("rename from ")) {
        cur.status = "renamed";
        oldPath = raw.slice("rename from ".length).trim();
      } else if (raw.startsWith("rename to ")) newPath = raw.slice("rename to ".length).trim();
      else if (raw.startsWith("Binary files ")) cur.binary = true;
      else if (raw.startsWith("--- ")) {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") oldPath = p.replace(/^a\//, "");
      } else if (raw.startsWith("+++ ")) {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") newPath = p.replace(/^b\//, "");
      }
      continue;
    }
    if (raw.startsWith("\\ No newline")) continue;
    if (raw === "") continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      hunk.lines.push({ kind: "add", text, oldLine: null, newLine: newNo });
      cur.additions += 1;
      newNo += 1;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", text, oldLine: oldNo, newLine: null });
      cur.deletions += 1;
      oldNo += 1;
    } else if (marker === " ") {
      hunk.lines.push({ kind: "ctx", text, oldLine: oldNo, newLine: newNo });
      oldNo += 1;
      newNo += 1;
    }
  }
  flush();
  return files;
}

type Probe = { top: string; head: string; remote: string; status: string; base: string; baseRef: string; signature: string };

/** Size + mtime of every path status names, so a worktree edit invalidates the cache even when the
 *  path-level status line is unchanged. Only changed files are stat'ed, never the tree. */
function worktreeSignature(top: string, status: string): string {
  const out: string[] = [];
  for (const entry of status.split("\0")) {
    if (entry.length < 4) continue;
    const path = entry.slice(3);
    try {
      const st = statSync(join(top, path));
      out.push(path + ":" + st.size + ":" + st.mtimeMs + ":" + st.ino);
    } catch {
      out.push(path + ":missing");
    }
  }
  return out.join("|");
}

function probe(root: string, git: GitRun, baseRef: string): Probe | null {
  const at = resolve(root);
  const top = git(at, ["rev-parse", "--show-toplevel"])?.trim();
  if (!top) return null;
  const head = git(top, ["rev-parse", "HEAD"])?.trim() ?? "";
  const remote = git(top, ["rev-parse", "--verify", "--quiet", "origin/main"])?.trim() ?? "";
  const status = git(top, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]) ?? "";
  // Without a HEAD (an uncommitted repository) there is no diff to show.
  const mergeBase = head ? git(top, ["merge-base", "HEAD", baseRef])?.trim() ?? "" : "";
  const signature = createHash("sha1").update([head, remote, status, worktreeSignature(top, status)].join("\0")).digest("hex");
  const label = baseRef === "origin/main" ? "main" : baseRef;
  return { top, head, remote, status, base: mergeBase || head, baseRef: mergeBase ? label : "HEAD", signature };
}

function untrackedPaths(status: string): string[] {
  const out: string[] = [];
  for (const entry of status.split("\0")) {
    if (!entry.startsWith("?? ")) continue;
    const path = normalizeRepoPath(entry.slice(3));
    if (path) out.push(path);
  }
  return out;
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
  const p = probe(root, opts.git ?? gitRun, opts.baseRef ?? "origin/main");
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
  const p = probe(root, opts.git ?? gitRun, opts.baseRef ?? "origin/main");
  if (!p) return null;
  const hit = CACHE.get(p.top);
  if (hit?.signature === p.signature) return hit.snapshot;
  const snapshot = assemble(p, opts);
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  CACHE.set(p.top, { signature: p.signature, snapshot });
  return snapshot;
}

export { emptySnapshot };

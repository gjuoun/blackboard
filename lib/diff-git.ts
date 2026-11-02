/** The git seam: run a command against one repository and read the worktree text a diff needs. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeRepoPath } from "./repo-path";

/** git subprocess seam: unit tests inject a runner to count calls or simulate a missing git. */
export type GitRun = (cwd: string, args: string[]) => string | null;
/** file-read seam: unit tests inject a reader to prove each relevant file is read at most once. */
export type FileRead = (abs: string) => string | null;

/**
 * baseRef names the branch the chip shows; base pins one commit to diff against. A pinned base is
 * used verbatim (no merge-base lookup): the document that carries the pin keeps showing the change
 * it was written against, even after the branch moves.
 */
export type DiffOptions = { git?: GitRun; readFile?: FileRead; baseRef?: string; base?: string };

const GIT_TIMEOUT_MS = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;

export const gitRun: GitRun = (cwd, args) => {
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

export const readUtf8: FileRead = (abs) => {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

/** What one repository looked like when the snapshot was built: enough to key its cache entry. */
export type Probe = { top: string; head: string; remote: string; status: string; base: string; baseRef: string; signature: string };

/** Size + mtime of every path status names, so a worktree edit invalidates the cache even when the
 *  path-level status line is unchanged. Only changed files are stat, never the tree. */
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

export function probe(root: string, git: GitRun, baseRef: string, pinned?: string): Probe | null {
  const at = resolve(root);
  const top = git(at, ["rev-parse", "--show-toplevel"])?.trim();
  if (!top) return null;
  const head = git(top, ["rev-parse", "HEAD"])?.trim() ?? "";
  const remote = git(top, ["rev-parse", "--verify", "--quiet", "origin/main"])?.trim() ?? "";
  const status = git(top, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]) ?? "";
  const label = baseRef === "origin/main" ? "main" : baseRef;
  // A pin replaces the merge-base lookup (same call count: one rev-parse instead of merge-base).
  // An unresolvable pin stays empty rather than silently floating to a newer base.
  const pin = pinned ? git(top, ["rev-parse", "--verify", "--quiet", pinned + "^{commit}"])?.trim() ?? "" : "";
  // Without a HEAD (an uncommitted repository) there is no diff to show.
  const mergeBase = !pinned && head ? git(top, ["merge-base", "HEAD", baseRef])?.trim() ?? "" : "";
  const base = pinned ? pin : mergeBase || head;
  const signature = createHash("sha1").update([head, remote, status, worktreeSignature(top, status), pinned ?? "", base].join("\0")).digest("hex");
  return { top, head, remote, status, base, baseRef: pinned ? label : mergeBase ? label : "HEAD", signature };
}

export function untrackedPaths(status: string): string[] {
  const out: string[] = [];
  for (const entry of status.split("\0")) {
    if (!entry.startsWith("?? ")) continue;
    const path = normalizeRepoPath(entry.slice(3));
    if (path) out.push(path);
  }
  return out;
}
/**
 * The File tab's data for one request: the file's lines and the set of lines that differ from HEAD.
 * One `git diff` call and one `git ls-files --error-unmatch` call per request, never one per line.
 */
import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { allAdded, parseChangedLines, type ChangedLines } from "./file-view";

const GIT_MS = 2000;

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, timeout: GIT_MS, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).toString();
  } catch {
    return null;
  }
}

/**
 * Changed lines of `path` against HEAD. A tracked file gets its hunks; an untracked file is all new; a file
 * outside git gets none (empty sets).
 */
export function changedAgainstHead(repoRoot: string | null, absPath: string, lineCount: number): ChangedLines {
  if (!repoRoot) return { added: new Set(), modified: new Set() };
  const rel = relative(repoRoot, absPath).split("\\").join("/");
  const tracked = git(repoRoot, ["ls-files", "--error-unmatch", "--", rel]) !== null;
  if (!tracked) return allAdded(lineCount);
  const diff = git(repoRoot, ["diff", "--unified=0", "HEAD", "--", rel]);
  return diff ? parseChangedLines(diff) : { added: new Set(), modified: new Set() };
}

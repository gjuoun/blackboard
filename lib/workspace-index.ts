/**
 * The workspace tree's data: the repo's tracked files, read once per (repo, HEAD) and kept in a small
 * map. Rendering a tree then reads only this list, never the filesystem, so the cost does not grow with
 * the number of nodes drawn.
 */
import { execFileSync } from "node:child_process";

export type WorkspaceIndex = { head: string; files: readonly string[] };

/** Keeps at most this many repos. Each entry is one path list; the oldest is dropped first. */
export const INDEX_CAP = 8;
const cache = new Map<string, WorkspaceIndex>();

/** Injected for tests: counts git invocations. Default runs git. */
export let gitRunner: (root: string, args: string[]) => string = (root, args) =>
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).toString();
export function setGitRunner(fn: typeof gitRunner) {
  gitRunner = fn;
}

/** The index for a repo's current HEAD. Null outside git. Two git calls on a cache miss, one on a hit. */
export function buildWorkspaceIndex(root: string): WorkspaceIndex | null {
  let head: string;
  try {
    head = gitRunner(root, ["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
  const key = `${root}\0${head}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let files: string[];
  try {
    files = gitRunner(root, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  } catch {
    return null;
  }
  const index = { head, files };
  if (cache.size >= INDEX_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(key, index);
  return index;
}

/** For tests: an empty cache. */
export function resetWorkspaceCache() {
  cache.clear();
}

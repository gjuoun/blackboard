import { isAbsolute, posix } from "node:path";

/**
 * A repository-relative path we are willing to expose: no absolute paths, no escapes, no NUL.
 * Shared by the diff index and the comment anchors; kept free of the git/fs layer so a client
 * component can validate an anchor without bundling a server module.
 */
export function normalizeRepoPath(path: string): string | null {
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path)) return null;
  const norm = posix.normalize(path).replace(/^\.\//, "");
  if (!norm || norm === "." || norm === ".." || norm.startsWith("../") || norm.startsWith("/")) return null;
  return norm;
}

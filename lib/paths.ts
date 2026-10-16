import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The folder that holds every board. Required: the app has nothing to show without it. */
export function getRoot(explicit?: string): string {
  const root = explicit ?? process.env.BLACKBOARD_ROOT;
  if (!root) throw new Error("BLACKBOARD_ROOT is not set: point it at a folder of boards");
  const abs = resolve(root.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  if (!existsSync(abs)) throw new Error(`BLACKBOARD_ROOT does not exist: ${abs}`);
  return realpathSync(abs);
}

function isInside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

const isDanglingLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Realpath of the deepest part of `p` that exists, with the missing tail re-attached.
 * Null for a dangling symlink: writing through it would create its target, wherever that is.
 */
function realpathPartial(p: string): string | null {
  let head = p;
  const tail: string[] = [];
  while (!existsSync(head)) {
    if (isDanglingLink(head)) return null;
    const parent = dirname(head);
    if (parent === head) return p;
    tail.unshift(head.slice(parent.length + 1));
    head = parent;
  }
  return join(realpathSync(head), ...tail);
}

/**
 * Resolve `rel` against `root`, or return null if the result would leave the root.
 * Covers `..`, absolute paths, NUL bytes, and symlinks that point outside. The path may
 * not exist yet (a new board folder, the comment file), so only its existing prefix is realpathed.
 */
export function resolveSafe(root: string, rel: string): string | null {
  if (rel.includes("\0") || isAbsolute(rel)) return null;
  const realRoot = realpathPartial(resolve(root));
  if (!realRoot) return null;
  const lexical = resolve(realRoot, rel);
  if (!isInside(realRoot, lexical)) return null;
  const real = realpathPartial(lexical);
  return real && isInside(realRoot, real) ? real : null;
}

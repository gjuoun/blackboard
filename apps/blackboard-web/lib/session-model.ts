import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { expandHome } from "./home";

/**
 * The session model and the file rules a session must pass, with no database and no Effect in
 * them. The UI imports this module, so it must not reach `blackboard.db`; the store lives in
 * `sessions.ts`.
 */
export type Session = { id: string; path: string; createdAt: string; openedAt: string };

export class SessionError extends Error {}

type Checked = { ok: true; path: string } | { ok: false; error: SessionError };

/**
 * The real path of a markdown file, or why not. The check is on the real path,
 * so `notes.md -> /etc/passwd` is refused: only files that really are markdown get served.
 */
export function checkDoc(file: string, cwd: string): Checked {
  if (!file || file.includes("\0")) return { ok: false, error: new SessionError("bad file path") };
  const abs = resolve(cwd, expandHome(file));
  const entry = lstatSync(abs, { throwIfNoEntry: false });
  if (!entry) return { ok: false, error: new SessionError(`no such file: ${abs}`) };
  const isLink = entry.isSymbolicLink();
  // Docs live anywhere on disk by design; the ignore comments keep the build from tracing the whole project.
  if (!existsSync(/*turbopackIgnore: true*/ abs)) {
    return {
      ok: false,
      error: new SessionError(isLink ? `dangling symlink: ${abs}` : `no such file: ${abs}`),
    };
  }
  const real = realpathSync(/*turbopackIgnore: true*/ abs);
  const entryReal = statSync(real, { throwIfNoEntry: false });
  if (!entryReal || !entryReal.isFile() || !real.toLowerCase().endsWith(".md"))
    return { ok: false, error: new SessionError(`not a markdown file: ${abs}`) };
  return { ok: true, path: real };
}

export function realDoc(file: string, cwd = process.cwd()): string {
  const checked = checkDoc(file, cwd);
  if (!checked.ok) throw checked.error;
  return checked.path;
}

/**
 * The key a session's comments are filed under: the file's basename.
 */
export function docKey(s: Session): string {
  return basename(s.path);
}

/**
 * The session file if it can still be served: it exists, is markdown, and still realpaths to
 * itself (a file swapped for a symlink to somewhere else is refused). Null otherwise.
 */
export function servablePath(s: Session): string | null {
  const checked = checkDoc(s.path, process.cwd());
  return checked.ok && checked.path === s.path ? s.path : null;
}

/** "/Users/me/notes/a.md" -> "~/notes/a.md". */
export function tildify(p: string): string {
  const h = process.env.HOME;
  return h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}

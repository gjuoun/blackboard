import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readComments } from "./comments-store";
import { docMeta, type DocMeta } from "./doc-meta";
import { expandHome } from "./home";
import { withFileLock } from "./lock";

/**
 * A session is one markdown file, anywhere on disk, that someone opened for review.
 * The registry is <home>/sessions.json — plain JSON, so an agent can read it from disk.
 */
export type Session = { id: string; path: string; createdAt: string; openedAt: string };
type Registry = { version: 1; sessions: Session[] };

export const SCRATCHPAD_ID = "scratchpad";
const ID = /^[a-z0-9]{1,32}$/;

export class SessionError extends Error {}

const now = () => new Date().toISOString();
const registryPath = (home: string) => join(home, "sessions.json");

function readRegistry(home: string): Registry {
  const p = registryPath(home);
  if (!existsSync(p)) return { version: 1, sessions: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.sessions)) throw new SessionError(`unsupported session registry: ${p}`);
  return data as Registry;
}

function writeAtomic(p: string, data: Registry) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, p);
}

/** Read, change and write the registry under the same cross-process lock the comment files use. */
function update<T>(home: string, change: (r: Registry) => T): T {
  const p = registryPath(home);
  mkdirSync(home, { recursive: true });
  return withFileLock(p, () => {
    const reg = readRegistry(home);
    const out = change(reg);
    writeAtomic(p, reg);
    return out;
  });
}

/**
 * The real path of a markdown file, or an error saying why not. The check is on the real path,
 * so `notes.md -> /etc/passwd` is refused: only files that really are markdown get served.
 */
export function realDoc(file: string, cwd = process.cwd()): string {
  if (!file || file.includes("\0")) throw new SessionError("bad file path");
  const abs = resolve(cwd, expandHome(file));
  let isLink = false;
  try {
    isLink = lstatSync(abs).isSymbolicLink();
  } catch {
    throw new SessionError(`no such file: ${abs}`);
  }
  // Docs live anywhere on disk by design; the ignore comments keep the build from tracing the whole project.
  if (!existsSync(/*turbopackIgnore: true*/ abs)) throw new SessionError(isLink ? `dangling symlink: ${abs}` : `no such file: ${abs}`);
  const real = realpathSync(/*turbopackIgnore: true*/ abs);
  if (!statSync(real).isFile() || !real.toLowerCase().endsWith(".md")) throw new SessionError(`not a markdown file: ${abs}`);
  return real;
}

/**
 * The session's file if it can still be served: it exists, is markdown, and still realpaths to
 * itself (a file swapped for a symlink to somewhere else is refused). Null otherwise.
 */
export function servablePath(s: Session): string | null {
  try {
    return realDoc(s.path) === s.path ? s.path : null;
  } catch {
    return null;
  }
}

/** Stable per file: opening the same file again finds the same session. */
export const sessionId = (realPath: string) => createHash("sha1").update(realPath).digest("hex").slice(0, 10);

function upsert(reg: Registry, id: string, path: string): Session {
  const t = now();
  const found = reg.sessions.find((s) => s.id === id);
  if (found) {
    found.path = path;
    found.openedAt = t;
    return { ...found };
  }
  const s: Session = { id, path, createdAt: t, openedAt: t };
  reg.sessions.push(s);
  return { ...s };
}

/** Register a markdown file (or bump it if already registered). */
export function openSession(home: string, file: string, cwd = process.cwd()): Session {
  const real = realDoc(file, cwd);
  return update(home, (reg) => upsert(reg, sessionId(real), real));
}

export function listSessions(home: string): Session[] {
  return readRegistry(home).sessions;
}

export function getSession(home: string, id: string): Session | null {
  if (!ID.test(id)) return null;
  return readRegistry(home).sessions.find((s) => s.id === id) ?? null;
}

/** Forget a session. Its comment folder stays, so opening the file again brings the comments back. */
export function closeSession(home: string, id: string): Session {
  return update(home, (reg) => {
    const i = reg.sessions.findIndex((s) => s.id === id);
    if (i < 0) throw new SessionError(`no session ${id}`);
    return reg.sessions.splice(i, 1)[0];
  });
}

/**
 * Where a session's comments live: <home>/sessions/<id>/comments.json, outside the doc's repo.
 * The file's `docs` map has one key, the doc's file name.
 */
export function sessionCommentsPath(home: string, id: string): string {
  if (!ID.test(id)) throw new SessionError(`bad session id "${id}"`);
  return join(home, "sessions", id, "comments.json");
}

/** An id, or a path (relative to `cwd`) to a registered file. Null when neither matches. */
export function resolveSession(home: string, idOrPath: string, cwd = process.cwd()): Session | null {
  const byId = getSession(home, idOrPath);
  if (byId) return byId;
  let real: string;
  try {
    real = realDoc(idOrPath, cwd);
  } catch {
    return null;
  }
  return getSession(home, sessionId(real));
}

/** One line of the session list: the registry entry plus what the file says about itself. */
export type SessionRow = Session &
  Pick<DocMeta, "title" | "repo" | "branch" | "detached" | "worktree" | "missing" | "stats"> & {
    /** "repo/rel/path.md" inside git, the absolute path outside it. */
    location: string;
    updatedAt: string;
    /** Open comments. */
    open: number;
  };

/** "/Users/me/notes/a.md" -> "~/notes/a.md". */
export function tildify(p: string): string {
  const h = process.env.HOME;
  return h && p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}

function openCount(home: string, id: string): number {
  try {
    return Object.values(readComments(sessionCommentsPath(home, id)).docs)
      .flat()
      .filter((c) => c.status === "open").length;
  } catch {
    return 0;
  }
}

export function sessionRow(home: string, s: Session): SessionRow {
  const commentsFile = sessionCommentsPath(home, s.id);
  const m = docMeta(s.path, commentsFile);
  return {
    ...s,
    title: m.title,
    repo: m.repo,
    branch: m.branch,
    detached: m.detached,
    worktree: m.worktree,
    missing: m.missing,
    stats: m.stats,
    location: m.repo ? `${m.repo.name}/${m.repo.relPath}` : tildify(s.path),
    updatedAt: m.updatedAt ?? s.openedAt,
    open: openCount(home, s.id),
  };
}

/** Every registered session with its title, location, branch and open comment count, most recently updated first. */
export function sessionRows(home: string): SessionRow[] {
  return listSessions(home)
    .map((s) => sessionRow(home, s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The one global scratchpad: <home>/scratchpad.md, created on first use, always registered. */
export function scratchpadSession(home: string): Session {
  const file = join(home, "scratchpad.md");
  mkdirSync(home, { recursive: true });
  try {
    writeFileSync(file, "# Scratchpad\n", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const existing = getSession(home, SCRATCHPAD_ID);
  if (existing) return existing;
  return update(home, (reg) => upsert(reg, SCRATCHPAD_ID, realpathSync(file)));
}

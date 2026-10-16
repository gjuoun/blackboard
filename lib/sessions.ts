import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  if (!existsSync(abs)) throw new SessionError(isLink ? `dangling symlink: ${abs}` : `no such file: ${abs}`);
  const real = realpathSync(abs);
  if (!statSync(real).isFile() || !real.toLowerCase().endsWith(".md")) throw new SessionError(`not a markdown file: ${abs}`);
  return real;
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

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { CommentsStore } from "./comments-store";
import { docMeta, type DocMeta } from "./doc-meta";
import { CODE_EXTENSIONS, CODE_MAX_BYTES, extOf, servableExtension } from "./doc-type";
import { errorMessage, IoFailure, type LockTimeout } from "./effect/errors";
import { expandHome } from "./home";
import { Lock } from "./lock";

/**
 * A session is one markdown file, anywhere on disk, that someone opened for review.
 * The registry is <home>/sessions.json — plain JSON, so an agent can read it from disk.
 */
export type SessionKind = "plain" | "stream";
/** A session is one registered file; stream sessions are .jsonl blocks, every other session is plain. */
export type Session = { id: string; path: string; createdAt: string; openedAt: string; kind?: SessionKind };
type Registry = { version: 1; sessions: Session[] };

export const SCRATCHPAD_ID = "scratchpad";
const ID = /^[a-z0-9]{1,32}$/;

export class SessionError extends Error {}

const now = () => new Date().toISOString();
const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });
const registryPath = (home: string) => join(home, "sessions.json");

/** The registry as JSON; a file that does not parse is an error, never silently replaced. */
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

type Checked = { ok: true; path: string } | { ok: false; error: SessionError };

/**
 * The real path of a markdown file, or why not. The check is on the real path,
 * so `notes.md -> /etc/passwd` is refused: only files that really are markdown get served.
 */
function checkDoc(file: string, cwd: string): Checked {
  if (!file || file.includes("\0")) return { ok: false, error: new SessionError("bad file path") };
  const abs = resolve(cwd, expandHome(file));
  const entry = lstatSync(abs, { throwIfNoEntry: false });
  if (!entry) return { ok: false, error: new SessionError(`no such file: ${abs}`) };
  const isLink = entry.isSymbolicLink();
  // Docs live anywhere on disk by design; the ignore comments keep the build from tracing the whole project.
  if (!existsSync(/*turbopackIgnore: true*/ abs)) {
    return { ok: false, error: new SessionError(isLink ? `dangling symlink: ${abs}` : `no such file: ${abs}`) };
  }
  const real = realpathSync(/*turbopackIgnore: true*/ abs);
  const entryReal = statSync(real, { throwIfNoEntry: false });
  if (!entryReal || !entryReal.isFile() || !servableExtension(real)) return { ok: false, error: new SessionError(`not a markdown file: ${abs}`) };
  // The 1 MB cap is for source files only: a stream grows by appending, and is not capped here.
  const isCode = (CODE_EXTENSIONS as readonly string[]).includes(extOf(real));
  if (isCode && entryReal.size > CODE_MAX_BYTES) return { ok: false, error: new SessionError(`over 1 MB: ${abs}`) };
  return { ok: true, path: real };
}

export function realDoc(file: string, cwd = process.cwd()): string {
  const checked = checkDoc(file, cwd);
  if (!checked.ok) throw checked.error;
  return checked.path;
}

/**
 * The session file if it can still be served: it exists, is markdown, and still realpaths to
 * itself (a file swapped for a symlink to somewhere else is refused). Null otherwise.
 */
export function servablePath(s: Session): string | null {
  const checked = checkDoc(s.path, process.cwd());
  return checked.ok && checked.path === s.path ? s.path : null;
}

/** Stable per file: opening the same file again finds the same session. */
export const sessionId = (realPath: string) => createHash("sha1").update(realPath).digest("hex").slice(0, 10);

function upsert(reg: Registry, id: string, path: string, kind?: SessionKind): Session {
  const t = now();
  const found = reg.sessions.find((s) => s.id === id);
  if (found) {
    found.path = path;
    found.openedAt = t;
    // Re-opening without --kind keeps the recorded kind: the tab does not vanish because a
    // later command omitted a flag.
    if (kind) found.kind = kind;
    return { ...found };
  }
  const s: Session = { id, path, createdAt: t, openedAt: t, kind: kind ?? "plain" };
  reg.sessions.push(s);
  return { ...s };
}

/** One line of the session list: the registry entry plus what the file says about itself. */
export type SessionRow = Session &
  Pick<DocMeta, "title" | "repo" | "branch" | "detached" | "worktree" | "project" | "missing" | "stats"> & {
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

/**
 * Where a session comments live: <home>/sessions/<id>/comments.json, outside the doc repo.
 * The file docs map has one key, the doc file name.
 */
export function sessionCommentsPath(home: string, id: string): string {
  if (!ID.test(id)) throw new SessionError(`bad session id "${id}"`);
  return join(home, "sessions", id, "comments.json");
}

/** The session registry, under the same cross-process lock the comment files use. */
export class SessionsStore extends Context.Service<
  SessionsStore,
  {
    list(home: string): Effect.Effect<Session[], IoFailure>;
    get(home: string, id: string): Effect.Effect<Session | null, IoFailure>;
    open(home: string, file: string, cwd?: string, kind?: SessionKind): Effect.Effect<Session, IoFailure | LockTimeout>;
    close(home: string, id: string): Effect.Effect<Session, IoFailure | LockTimeout>;
    resolve(home: string, idOrPath: string, cwd?: string): Effect.Effect<Session | null, IoFailure | LockTimeout>;
    scratchpad(home: string): Effect.Effect<Session, IoFailure | LockTimeout>;
    row(home: string, session: Session): Effect.Effect<SessionRow, IoFailure>;
    rows(home: string): Effect.Effect<SessionRow[], IoFailure | LockTimeout>;
  }
>()("blackboard/SessionsStore") {}

export const layer = Layer.effect(
  SessionsStore,
  Effect.gen(function* () {
    const lock = yield* Lock;
    const comments = yield* CommentsStore;

    const read = (home: string) => Effect.try({ try: () => readRegistry(home), catch: failure });
    const update = <A>(home: string, change: (reg: Registry) => A): Effect.Effect<A, IoFailure | LockTimeout> =>
      Effect.gen(function* () {
        yield* Effect.sync(() => mkdirSync(home, { recursive: true }));
        return yield* lock.withLock(
          registryPath(home),
          Effect.try({
            try: () => {
              const reg = readRegistry(home);
              const out = change(reg);
              writeAtomic(registryPath(home), reg);
              return out;
            },
            catch: failure,
          }),
        );
      });

    const list = (home: string) => read(home).pipe(Effect.map((reg) => reg.sessions));
    const get = (home: string, id: string) =>
      Effect.suspend(() => (ID.test(id) ? list(home).pipe(Effect.map((all) => all.find((s) => s.id === id) ?? null)) : Effect.succeed(null)));

    const row = (home: string, s: Session): Effect.Effect<SessionRow, IoFailure> =>
      Effect.gen(function* () {
        const commentsFile = sessionCommentsPath(home, s.id);
        const open = yield* comments.read(commentsFile).pipe(
          Effect.map((file) => Object.values(file.docs).flat().filter((c) => c.status === "open").length),
          Effect.catch(() => Effect.succeed(0)),
        );
        const m = yield* Effect.try({ try: () => docMeta(s.path, commentsFile), catch: failure });
        return {
          ...s,
          title: m.title,
          repo: m.repo,
          branch: m.branch,
          detached: m.detached,
          worktree: m.worktree,
          project: m.project,
          missing: m.missing,
          stats: m.stats,
          location: m.repo ? `${m.repo.name}/${m.repo.relPath}` : tildify(s.path),
          updatedAt: m.updatedAt ?? s.openedAt,
          open,
        };
      });

    return SessionsStore.of({
      list,
      get,
      row,
      open: (home, file, cwd = process.cwd(), kind) =>
        Effect.flatMap(Effect.try({ try: () => realDoc(file, cwd), catch: failure }), (real) =>
          update(home, (reg) => upsert(reg, sessionId(real), real, kind)),
        ),
      close: (home, id) =>
        update(home, (reg) => {
          const i = reg.sessions.findIndex((s) => s.id === id);
          if (i < 0) throw new SessionError(`no session ${id}`);
          return reg.sessions.splice(i, 1)[0];
        }),
      resolve: (home, idOrPath, cwd = process.cwd()) =>
        Effect.gen(function* () {
          const byId = yield* get(home, idOrPath);
          if (byId) return byId;
          const checked = checkDoc(idOrPath, cwd);
          if (!checked.ok) return null;
          return yield* get(home, sessionId(checked.path));
        }),
      scratchpad: (home) =>
        Effect.gen(function* () {
          const file = join(home, "scratchpad.md");
          yield* Effect.sync(() => mkdirSync(home, { recursive: true }));
          const created = Effect.try({
            try: () => writeFileSync(file, "# Scratchpad\n", { flag: "wx" }),
            catch: (error) => error as NodeJS.ErrnoException,
          });
          yield* created.pipe(
            Effect.catchIf((error) => error.code === "EEXIST", () => Effect.void),
            Effect.catch((error) => Effect.fail(failure(error))),
          );
          const existing = yield* get(home, SCRATCHPAD_ID);
          if (existing) return existing;
          return yield* update(home, (reg) => upsert(reg, SCRATCHPAD_ID, realpathSync(file)));
        }),
      rows: (home) =>
        Effect.gen(function* () {
          const sessions = yield* list(home);
          const rows = yield* Effect.forEach(sessions, (s) => row(home, s));
          return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }),
    });
  }),
);
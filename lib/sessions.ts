import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { CommentsStore } from "./comments-store";
import { DocumentsRepo, type DocRow } from "./db/repos/documents";
import { docMeta, type DocMeta } from "./doc-meta";
import { errorMessage, IoFailure, type LockTimeout } from "./effect/errors";
import { checkDoc, realDoc, SCRATCHPAD_ID, SessionError, tildify, type Session } from "./session-model";

export { realDoc, SCRATCHPAD_ID, servablePath, SessionError, tildify, type Session } from "./session-model";

/**
 * The session registry, backed by the documents table. The file rules a session must pass live in
 * `session-model.ts`: no database there, so the UI can import them without reaching blackboard.db.
 */
export type Registry = { version: 1; sessions: Session[] };
const ID = /^[a-z0-9]{1,32}$/;

const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** sessions.json as a value, for the migration only; a file that does not parse is an error. */
export function readRegistry(home: string): Registry {
  const p = join(home, "sessions.json");
  if (!existsSync(p)) return { version: 1, sessions: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.sessions)) throw new SessionError(`unsupported session registry: ${p}`);
  return data as Registry;
}

/** Stable per file: opening the same file again finds the same session. */
export const sessionId = (realPath: string) => createHash("sha1").update(realPath).digest("hex").slice(0, 10);

/** One line of the session list: the registry entry plus what the file says about itself. */
export type SessionRow = Session &
  Pick<DocMeta, "title" | "repo" | "branch" | "detached" | "worktree" | "project" | "missing" | "stats"> & {
    /** "repo/rel/path.md" inside git, the absolute path outside it. */
    location: string;
    updatedAt: string;
    /** Open comments. */
    open: number;
  };

/**
 * Where a session's comment file would live: <home>/sessions/<id>/comments.json. Post-migration
 * the folder only matters to the JSON sources and to docMeta's updatedAt blend; it is not read.
 */
export function sessionCommentsPath(home: string, id: string): string {
  if (!ID.test(id)) throw new SessionError(`bad session id "${id}"`);
  return join(home, "sessions", id, "comments.json");
}

const toSession = (row: DocRow): Session => ({
  id: row.id,
  path: row.path ?? "",
  createdAt: row.createdAt,
  openedAt: row.openedAt,
  ...(row.kind ? { kind: row.kind } : {}),
});

/** The session registry, backed by the documents table. */
export class SessionsStore extends Context.Service<
  SessionsStore,
  {
    list(home: string): Effect.Effect<Session[], IoFailure>;
    get(home: string, id: string): Effect.Effect<Session | null, IoFailure>;
    open(home: string, file: string, cwd?: string): Effect.Effect<Session, IoFailure | LockTimeout>;
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
    const docs = yield* DocumentsRepo;
    const comments = yield* CommentsStore;

    const list = (home: string) => docs.list(home).pipe(Effect.map((rows) => rows.map(toSession)), Effect.mapError(failure));
    const get = (home: string, id: string) =>
      Effect.suspend(() =>
        ID.test(id)
          ? docs.get(home, id).pipe(Effect.map((row) => (row ? toSession(row) : null)), Effect.mapError(failure))
          : Effect.succeed(null),
      );

    const row = (home: string, s: Session): Effect.Effect<SessionRow, IoFailure> =>
      Effect.gen(function* () {
        const commentsFile = sessionCommentsPath(home, s.id);
        const open = yield* comments.countOpen(home, s.id).pipe(Effect.catch(() => Effect.succeed(0)));
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
      open: (home, file, cwd = process.cwd()) =>
        Effect.flatMap(Effect.try({ try: () => realDoc(file, cwd), catch: failure }), (real) =>
          docs.upsert(home, { id: sessionId(real), path: real }).pipe(Effect.map(toSession), Effect.mapError(failure)),
        ),
      close: (home, id) =>
        docs.remove(home, id).pipe(
          Effect.flatMap((row) =>
            row ? Effect.succeed(toSession(row)) : Effect.fail(new IoFailure({ message: `no session ${id}`, status: 500 })),
          ),
          Effect.mapError((e) => (e instanceof IoFailure ? e : failure(e))),
        ),
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
          return yield* docs.upsert(home, { id: SCRATCHPAD_ID, path: realpathSync(file) }).pipe(Effect.map(toSession), Effect.mapError(failure));
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

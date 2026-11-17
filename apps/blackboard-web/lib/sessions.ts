import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pipe, Safe } from "@gjuoun/safe-ts";
import type { CommentsStore } from "./comments-store";
import type { Db } from "./db/client";
import { type DocRow, type DocumentsRepo } from "./db/repos/documents";
import type { DocMeta } from "./doc-meta";
import { docMetaFromRow, indexedBody, indexIfNeeded, latestOf } from "./doc-read";
import { type DbFailure, errorMessage, IoFailure, type LockTimeout } from "./errors";
import { checkDoc, realDoc, type Session, SessionError, tildify } from "./session-model";

export { realDoc, type Session, SessionError, servablePath, tildify } from "./session-model";

/**
 * The session registry, backed by the documents table. The file rules a session must pass live in
 * `session-model.ts`: no database there, so the UI can import them without reaching blackboard.db.
 */
export type Registry = { version: 1; sessions: Session[] };
// Streamed docs carry `s-<ULID>` ids (uppercase Crockford, one dash); file sessions are sha1 hex.
const ID = /^[A-Za-z0-9-]{1,40}$/;

const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** sessions.json as a value, for the migration only; a file that does not parse is an error. */
export function readRegistry(home: string): Registry {
  const p = join(home, "sessions.json");
  if (!existsSync(p)) return { version: 1, sessions: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.sessions))
    throw new SessionError(`unsupported session registry: ${p}`);
  return data as Registry;
}

/** Stable per file: opening the same file again finds the same session. */
export const sessionId = (realPath: string) =>
  createHash("sha1").update(realPath).digest("hex").slice(0, 10);

/** The session row as the store keeps it. `srcMtime` is internal: it never leaves the process. See toWire. */
export type SessionRow = Session &
  Pick<DocMeta, "title" | "repo" | "branch" | "detached" | "worktree" | "project" | "missing" | "stats"> & {
    /** "repo/rel/path.md" inside git, the absolute path outside it. */
    location: string;
    updatedAt: string;
    /** Open comments. */
    open: number;
    /** The file mtime the database row was read from (ms); null when the file is missing or the row is unindexed. */
    srcMtime: number | null;
  };

/**
 * A session row as the wire and the CLI show it. The index column the store keeps for freshness stays
 * inside the process, so every response keeps the shape it always had.
 */
export function toWire<R extends { srcMtime?: number | null }>(row: R): Omit<R, "srcMtime"> {
  const { srcMtime: _omit, ...rest } = row;
  return rest;
}

/**
 * Where a session's comment file would live: <home>/sessions/<id>/comments.json. Post-migration the
 * folder only matters to the JSON sources and to docMeta's updatedAt blend; it is not read.
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
});

/** A database failure is an I/O failure to the callers of this store: same message, same status. */
const toIo = (error: DbFailure | IoFailure): IoFailure =>
  error instanceof IoFailure ? error : new IoFailure({ message: error.message, status: error.status });

/** `Safe<A, DbFailure>` → `Safe<A, IoFailure>`. */
const asIo = <A>(safe: Safe<A, DbFailure | IoFailure>): Safe<A, IoFailure> =>
  Safe.pipe(
    safe,
    Pipe.catchTag("DbFailure", (error: DbFailure) => Safe.err(toIo(error))),
  );

/** The session registry, backed by the documents table. */
export class SessionsStore {
  constructor(
    private readonly db: Db,
    private readonly docs: DocumentsRepo,
    private readonly comments: CommentsStore,
  ) {}

  list(home: string): Safe<Session[], IoFailure> {
    const docs = this.docs;
    return asIo(Safe.call(() => docs.list(home))) as unknown as Safe<Session[], IoFailure>;
  }

  get(home: string, id: string): Safe<Session | null, IoFailure> {
    if (!ID.test(id)) return Safe.ok(null);
    const docs = this.docs;
    return Safe.try(function* () {
      const row = (yield asIo(docs.get(home, id))) as DocRow | null;
      return row ? toSession(row) : null;
    });
  }

  open(home: string, file: string, cwd: string = process.cwd()): Safe<Session, IoFailure | LockTimeout> {
    const docs = this.docs;
    const db = this.db;
    return Safe.try(function* () {
      const real = (yield Safe.call(() => realDoc(file, cwd), failure)) as string;
      const row = (yield asIo(docs.upsert(home, { id: sessionId(real), path: real }))) as DocRow;
      // Index it now, so the first read finds a body. Registration already succeeded; an index failure
      // here leaves the row for the next read to index, and does not fail the open.
      yield Safe.pipe(
        indexIfNeeded(db, home, toSession(row)),
        Pipe.catchTag("DbFailure", () => Safe.ok(null)),
        Pipe.catchTag("IoFailure", () => Safe.ok(null)),
      );
      return toSession(row);
    });
  }

  close(home: string, id: string): Safe<Session, IoFailure | LockTimeout> {
    const docs = this.docs;
    return Safe.try(function* () {
      const row = (yield asIo(docs.remove(home, id))) as DocRow | null;
      if (!row) return (yield Safe.err(new IoFailure({ message: `no session ${id}`, status: 500 }))) as never;
      return toSession(row);
    });
  }

  resolve(home: string, idOrPath: string, cwd: string = process.cwd()): Safe<Session | null, IoFailure | LockTimeout> {
    const self = this;
    return Safe.try(function* () {
      const byId = (yield self.get(home, idOrPath)) as Session | null;
      if (byId) return byId;
      const checked = checkDoc(idOrPath, cwd);
      if (!checked.ok) return null;
      return (yield self.get(home, sessionId(checked.path))) as Session | null;
    });
  }

  row(home: string, s: Session): Safe<SessionRow, IoFailure> {
    const db = this.db;
    const comments = this.comments;
    return Safe.try(function* () {
      // The metadata comes from the database row, refreshed from the file when it changed: one stat per
      // read, a full re-index only on change. The open count is the comments table's.
      const open = (yield Safe.pipe(
        comments.countOpen(home, s.id),
        Pipe.catchTag("IoFailure", () => Safe.ok(0)),
      )) as number;
      const indexed = (yield asIo(indexIfNeeded(db, home, s))) as Awaited<ReturnType<typeof docMetaFromRow>>;
      const m = docMetaFromRow(indexed);
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
        updatedAt: latestOf(m.updatedAt, indexed.latestCommentAt) ?? s.openedAt,
        open,
        srcMtime: indexed.srcSize === -1 ? null : indexed.srcMtime,
      };
    });
  }

  rows(home: string): Safe<SessionRow[], IoFailure | LockTimeout> {
    const self = this;
    return Safe.try(function* () {
      const sessions = (yield self.list(home)) as Session[];
      const rows: SessionRow[] = [];
      for (const s of sessions) rows.push((yield self.row(home, s)) as SessionRow);
      return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  /** The markdown a document was indexed from, or null when there is none to read. */
  body(home: string, id: string): Safe<string | null, IoFailure> {
    const db = this.db;
    return Safe.try(function* () {
      return (yield asIo(indexedBody(db, home, id))) as string | null;
    });
  }
}
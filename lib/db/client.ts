import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { errorMessage, DbFailure } from "../effect/errors";

/**
 * The one SQLite database for Blackboard: `<home>/blackboard.db`, WAL mode, foreign keys on.
 * The driver is `bun:sqlite`, required lazily on first use — module import alone loads nothing,
 * so a Node-hosted Next server can carry this module in its bundle without touching `bun:`.
 * A runtime that is not Bun fails the open with a clean DbFailure.
 *
 * Connections are cached per `home` for the layer's lifetime: one process, one handle per
 * database. Tests pass a temp `BLACKBOARD_HOME` and get a database of their own.
 */

/** bun:sqlite runs exactly one statement per call — complete statements, no semicolons. */
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    path TEXT,
    created_at TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    kind TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    n INTEGER NOT NULL,
    action TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    images TEXT,
    status TEXT,
    at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS blocks_document_id ON blocks(document_id)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    doc TEXT NOT NULL,
    anchor_kind TEXT NOT NULL,
    quote TEXT,
    body TEXT NOT NULL,
    images TEXT,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL,
    edited_at TEXT,
    status TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT,
    reopened_at TEXT,
    reopened_by TEXT,
    replies TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS comments_document_id_doc ON comments(document_id, doc)`,
  `CREATE INDEX IF NOT EXISTS comments_status ON comments(status)`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    doc TEXT NOT NULL,
    round INTEGER NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL,
    verdict TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS reviews_document_id ON reviews(document_id)`,
  `CREATE TABLE IF NOT EXISTS reading_state (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    progress REAL NOT NULL,
    read_at TEXT NOT NULL,
    source_mtime INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    session TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    pi_session TEXT NOT NULL,
    url TEXT NOT NULL,
    bound_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
];

/** The driver type: bun:sqlite's Database, typed without importing the module under Node. */
type RawDb = {
  run(sql: string): void;
  exec(sql: string): void;
  query(sql: string): { get(): Record<string, unknown> | null; all(): Record<string, unknown>[] };
};

/** The live handle: drizzle for typed queries, raw for PRAGMAs and one-off SQL. */
type Conn = { orm: BunSQLiteDatabase; raw: RawDb };

const open = (home: string): Effect.Effect<Conn, DbFailure> =>
  Effect.try({
    try: () => {
      // Deferred by design: this is the only place `bun:sqlite` is loaded. createRequire keeps it
      // out of every Node import graph — Next.js bundling under Node can trace this module and
      // never resolves the specifier, while the statement itself only runs on first Db use.
      const { Database } = createRequire(import.meta.url)("bun:sqlite") as unknown as {
        Database: new (path: string) => RawDb;
      };
      mkdirSync(home, { recursive: true });
      const raw = new Database(join(home, "blackboard.db"));
      raw.run("PRAGMA journal_mode=WAL");
      raw.run("PRAGMA foreign_keys=ON");
      raw.run("PRAGMA busy_timeout=5000");
      for (const stmt of DDL) raw.exec(stmt);
      return { orm: drizzle(raw as never), raw };
    },
    catch: (error) => new DbFailure({ message: `cannot open blackboard.db: ${errorMessage(error)}`, status: 500 }),
  });

export class Db extends Context.Service<
  Db,
  {
    /** Run `fn` against the (lazily opened) database for `home`. */
    use<A>(home: string, fn: (db: BunSQLiteDatabase) => A): Effect.Effect<A, DbFailure>;
    /** The underlying bun:sqlite handle — PRAGMAs and one-off SQL, not typed queries. */
    raw<A>(home: string, fn: (db: RawDb) => A): Effect.Effect<A, DbFailure>;
    /** Run `fn` inside one SQLite transaction; the result is `fn`'s return value. */
    withTransaction<A>(home: string, fn: (db: BunSQLiteDatabase) => A): Effect.Effect<A, DbFailure>;
  }
>()("blackboard/Db") {}

export const layer = Layer.effect(
  Db,
  Effect.sync(() => {
    // One open per home per process. A plain Map<string, Promise> suffices: the open is sync,
    // and a second use of the same home reuses the handle rather than racing a new one.
    const dbs = new Map<string, Promise<Conn>>();
    const conn = (home: string): Effect.Effect<Conn, DbFailure> =>
      Effect.suspend(() => {
        const held = dbs.get(home);
        if (held) return Effect.promise(() => held);
        const made = Effect.runPromise(open(home));
        dbs.set(home, made);
        return Effect.promise(() => made);
      });
    const run = <A>(home: string, fn: (db: Conn) => A): Effect.Effect<A, DbFailure> =>
      conn(home).pipe(
        Effect.flatMap((db) => Effect.try({ try: () => fn(db), catch: (e) => new DbFailure({ message: errorMessage(e), status: 500 }) })),
      );
    return Db.of({
      use: (home, fn) => run(home, ({ orm }) => fn(orm)),
      raw: (home, fn) => run(home, ({ raw }) => fn(raw)),
      withTransaction: (home, fn) => run(home, ({ orm }) => orm.transaction((tx) => fn(tx))),
    });
  }),
);

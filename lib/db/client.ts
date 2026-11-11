import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
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

/**
 * Document columns that tables created before them lack. Every column here is added by ALTER when missing, so a new
 * database and an old one end up with the same schema. The body and the metadata are derived from the file on disk;
 * `src_mtime` and `src_size` say which file state they were derived from.
 */
export const DOC_COLUMNS: readonly [string, string][] = [
  ["closed_at", "TEXT"],
  ["body", "TEXT"],
  ["title", "TEXT"],
  ["sections", "INTEGER"],
  ["diagrams", "INTEGER"],
  ["branch", "TEXT"],
  ["detached", "INTEGER"],
  ["repo_name", "TEXT"],
  ["repo_root", "TEXT"],
  ["rel_path", "TEXT"],
  ["worktree_name", "TEXT"],
  ["worktree_path", "TEXT"],
  ["project_name", "TEXT"],
  ["project_root", "TEXT"],
  ["src_mtime", "INTEGER"],
  ["src_size", "INTEGER"],
  ["indexed_at", "TEXT"],
  ["body_rev", "INTEGER"],
];

/** Comment columns that tables created before them lack (same ALTER-when-missing rule). */
export const COMMENT_COLUMNS: readonly [string, string][] = [
  ["block_id", "TEXT"],
  ["block_rev", "INTEGER"],
];

/** bun:sqlite runs exactly one statement per call — complete statements, no semicolons. */
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    path TEXT,
    created_at TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    kind TEXT,
    closed_at TEXT
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
  `CREATE TABLE IF NOT EXISTS content_blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    n INTEGER NOT NULL,
    grp INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    plain TEXT NOT NULL,
    hash TEXT NOT NULL,
    rev INTEGER NOT NULL,
    updated_rev INTEGER NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS content_blocks_document_id ON content_blocks(document_id)`,
  `CREATE TABLE IF NOT EXISTS content_block_revs (
    block_id TEXT NOT NULL REFERENCES content_blocks(id) ON DELETE CASCADE,
    rev INTEGER NOT NULL,
    text TEXT NOT NULL,
    plain TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS content_block_revs_block ON content_block_revs(block_id)`,
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
  query(sql: string): { get(...params: unknown[]): Record<string, unknown> | null; all(...params: unknown[]): Record<string, unknown>[] };
};

/** The live handle: drizzle for typed queries, raw for PRAGMAs and one-off SQL. */
type Conn = { orm: BunSQLiteDatabase; raw: RawDb };

const open = (home: string): Effect.Effect<Conn, DbFailure> =>
  Effect.try({
    try: () => {
      // Deferred by design: this is the only place `bun:sqlite` is loaded. createRequire keeps it
      // out of every Node import graph — Next.js bundling under Node can trace this module and
      // never resolves the specifier, while the statement itself only runs on first Db use.
      const req = createRequire(import.meta.url);
      const { Database } = req("bun:sqlite") as unknown as { Database: new (path: string) => RawDb };
      // Same deferral for the drizzle adapter: it statically requires bun:sqlite itself, so
      // pulling it at module eval would still break a Node import graph. Types are import-type only.
      const { drizzle } = req("drizzle-orm/bun-sqlite") as {
        drizzle: (raw: RawDb) => BunSQLiteDatabase;
      };
      mkdirSync(home, { recursive: true });
      const raw = new Database(join(home, "blackboard.db"));
      raw.run("PRAGMA journal_mode=WAL");
      raw.run("PRAGMA foreign_keys=ON");
      raw.run("PRAGMA busy_timeout=5000");
      for (const stmt of DDL) raw.exec(stmt);
      // Columns added after a database first existed. A fresh database gets them from the same statements.
      for (const [name, type] of DOC_COLUMNS) {
        const has = raw.query("SELECT name FROM pragma_table_info('documents') WHERE name = ?").get(name) !== null;
        if (!has) raw.exec(`ALTER TABLE documents ADD COLUMN ${name} ${type}`);
      }
      for (const [name, type] of COMMENT_COLUMNS) {
        const has = raw.query("SELECT name FROM pragma_table_info('comments') WHERE name = ?").get(name) !== null;
        if (!has) raw.exec(`ALTER TABLE comments ADD COLUMN ${name} ${type}`);
      }
      return { orm: drizzle(raw), raw };
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

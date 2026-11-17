import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { run, services } from "../../test/app";
import { type DbFailure, errorMessage, failures } from "../errors";
import { BASELINE_COLUMNS, BASELINE_TAG, MIGRATIONS } from "./migrations/bundled";

/**
 * The one SQLite database for Blackboard: `<home>/blackboard.db`, WAL mode, foreign keys on.
 * The driver is `bun:sqlite`, required lazily on first use — importing this module loads nothing, so
 * a Node import graph can carry it without touching `bun:`. A runtime that is not Bun fails the open
 * with a clean DbFailure. Handles are cached per `home` for the process's lifetime.
 */

const MIGRATIONS_TABLE = "__drizzle_migrations";

/** The driver type: bun:sqlite's Database, typed without importing the module under Node. */
export type RawDb = {
  run(sql: string): void;
  exec(sql: string): void;
  query(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | null;
    all(...params: unknown[]): Record<string, unknown>[];
  };
};

/** The live handle: drizzle for typed queries, raw for PRAGMAs and one-off SQL. */
export type Conn = { orm: BunSQLiteDatabase; raw: RawDb };

const tableExists = (raw: RawDb, name: string) =>
  raw.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;

/** Baseline ALTER pass for databases created before drizzle was wired in. */
const backfillBaselineColumns = (raw: RawDb) => {
  for (const [table, columns] of Object.entries(BASELINE_COLUMNS)) {
    if (!tableExists(raw, table)) continue;
    for (const { name, type } of columns) {
      const has =
        raw.query(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`).get(name) !== null;
      if (!has) raw.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${type}`);
    }
  }
};

/**
 * Apply bundled migrations the way drizzle's own migrator does: a migration runs when the last
 * recorded created_at is older than its folderMillis, inside one transaction, one bookkeeping row
 * per migration. The baseline file is idempotent, so an old database takes it and gets its columns
 * backfilled by the ALTER pass.
 */
function runMigrations(raw: RawDb): void {
  raw.exec(
    `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)`,
  );
  const last = raw
    .query(`SELECT created_at FROM \`${MIGRATIONS_TABLE}\` ORDER BY created_at DESC LIMIT 1`)
    .get();
  raw.exec("BEGIN");
  try {
    for (const m of MIGRATIONS) {
      if (last && Number(last.created_at) >= m.folderMillis) continue;
      for (const stmt of m.stmts) raw.exec(stmt);
      if (m.tag === BASELINE_TAG) backfillBaselineColumns(raw);
      raw.exec(
        `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES('${m.hash}', ${m.folderMillis})`,
      );
    }
    raw.exec("COMMIT");
  } catch (e) {
    raw.exec("ROLLBACK");
    throw e;
  }
}

/** Open a database. Deferred by design: the only place `bun:sqlite` is loaded. */
const open = (home: string): Conn => {
  const req = createRequire(import.meta.url);
  const { Database } = req("bun:sqlite") as unknown as { Database: new (path: string) => RawDb };
  const { drizzle } = req("drizzle-orm/bun-sqlite") as {
    drizzle: (raw: RawDb) => BunSQLiteDatabase;
  };
  mkdirSync(home, { recursive: true });
  const raw = new Database(join(home, "blackboard.db"));
  raw.run("PRAGMA journal_mode=WAL");
  raw.run("PRAGMA foreign_keys=ON");
  raw.run("PRAGMA busy_timeout=5000");
  runMigrations(raw);
  return { orm: drizzle(raw), raw };
};

const openFailure = (error: unknown): DbFailure =>
  failures.DbFailure(`cannot open blackboard.db: ${errorMessage(error)}`, 500);
const queryFailure = (error: unknown): DbFailure => failures.DbFailure(errorMessage(error), 500);

/** The connection cache. One instance per process, built by `bootstrap()`. */
export class Db {
  private readonly conns = new Map<string, Promise<Conn>>();

  private conn(home: string): Safe<Conn, DbFailure> {
    return Safe.call(async () => {
      const held = this.conns.get(home);
      if (held) return held;
      const made = (async () => open(home))();
      this.conns.set(home, made);
      return made;
    }, openFailure);
  }

  private run<A>(home: string, fn: (conn: Conn) => A): Safe<A, DbFailure> {
    const conn = this.conn(home);
    return Safe.try(function* () {
      const c = (yield conn) as Conn;
      return (yield Safe.call(() => fn(c), queryFailure)) as A;
    });
  }

  /** Run `fn` against the (lazily opened) database for `home`. */
  use<A>(home: string, fn: (db: BunSQLiteDatabase) => A): Safe<A, DbFailure> {
    return this.run(home, (c) => fn(c.orm));
  }

  /** The underlying bun:sqlite handle — PRAGMAs and one-off SQL, not typed queries. */
  raw<A>(home: string, fn: (db: RawDb) => A): Safe<A, DbFailure> {
    return this.run(home, (c) => fn(c.raw));
  }

  /** Run `fn` inside one SQLite transaction; the result is `fn`'s return value. */
  withTransaction<A>(home: string, fn: (db: BunSQLiteDatabase) => A): Safe<A, DbFailure> {
    return this.run(home, (c) => c.orm.transaction((tx) => fn(tx)));
  }
}

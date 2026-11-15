import { existsSync, mkdtempSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Comment, CommentFile } from "../comments-file";
import { errorMessage, IoFailure, type LockTimeout, type DbFailure } from "../effect/errors";
import { commentFiles, readAgentsFile, readCommentsFile, readReadingFile, readRegistryFile } from "../json-sources";
import { Lock } from "../lock";
import type { Session } from "../sessions";
import { Db } from "./client";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { agents, comments, documents, readingState, reviews } from "./schema";

/**
 * One-shot, idempotent migration of the four JSON stores into `<home>/blackboard.db`:
 * sessions.json → documents, sessions/&lt;id&gt;/comments.json → comments + reviews,
 * reading-state.json → reading_state, agents.json → agents. Sources are renamed to
 * `*.migrated`, never deleted — a second run finds nothing and reports so.
 *
 * A comments or reading-state file can outlive its session (close keeps it), so any
 * document id seen in a side file but missing from sessions.json gets a stub documents
 * row (path null) — otherwise the children's foreign keys would fail.
 */

export type MigrateReport = {
  dry: boolean;
  documents: number;
  comments: number;
  reviews: number;
  readingState: number;
  agents: number;
  /** Source files renamed to .migrated (empty on dry-run). */
  renamed: string[];
  nothing: boolean;
};

const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** Every migratable source that still exists as .json (not yet renamed). */
const sources = (home: string) => ({
  registry: join(home, "sessions.json"),
  comments: commentFiles(home),
  reading: join(home, "reading-state.json"),
  agents: join(home, "agents.json"),
});

const insert = (db: BunSQLiteDatabase, home: string): MigrateReport => {
  const src = sources(home);
  const hasRegistry = existsSync(src.registry);
  const hasReading = existsSync(src.reading);
  const hasAgents = existsSync(src.agents);
  const report: MigrateReport = { dry: false, documents: 0, comments: 0, reviews: 0, readingState: 0, agents: 0, renamed: [], nothing: false };

  const registry = hasRegistry ? readRegistryFile(home) : ({ version: 1, sessions: [] } as const);
  const ids = new Set(registry.sessions.map((s: Session) => s.id));

  // documents: registry rows first
  for (const s of registry.sessions) {
    db.insert(documents)
      .values({ id: s.id, path: s.path, createdAt: s.createdAt, openedAt: s.openedAt, kind: s.kind ?? null })
      .onConflictDoUpdate({ target: documents.id, set: { path: s.path, openedAt: s.openedAt, kind: s.kind ?? null } })
      .run();
    report.documents++;
  }

  // comments + reviews: every comments.json, session-stubbed when the session is gone
  for (const file of src.comments) {
    const id = file.split("/").at(-2)!;
    const parsed: CommentFile = readCommentsFile(file);
    if (!ids.has(id)) {
      db.insert(documents)
        .values({ id, path: null, createdAt: new Date(0).toISOString(), openedAt: new Date(0).toISOString(), kind: null })
        .onConflictDoNothing()
        .run();
      report.documents++;
      ids.add(id);
    }
    for (const [doc, list] of Object.entries(parsed.docs)) {
      for (const c of list as Comment[]) {
        db.insert(comments)
          .values({
            id: c.id, documentId: id, doc, anchor: c.quote ? "quote" : "general",
            quote: c.quote ?? null, body: c.body, images: c.images ?? null, author: c.author,
            createdAt: c.createdAt, editedAt: c.editedAt ?? null, status: c.status,
            resolvedAt: c.resolvedAt ?? null, resolvedBy: c.resolvedBy ?? null,
            reopenedAt: c.reopenedAt ?? null, reopenedBy: c.reopenedBy ?? null, replies: c.replies,
          })
          .onConflictDoUpdate({
            target: comments.id,
            set: { status: c.status, resolvedAt: c.resolvedAt ?? null, resolvedBy: c.resolvedBy ?? null, replies: c.replies, body: c.body, editedAt: c.editedAt ?? null },
          })
          .run();
        report.comments++;
      }
    }
    for (const r of parsed.reviews ?? []) {
      db.insert(reviews)
        .values({ id: r.id, documentId: id, doc: r.doc, round: r.round, body: r.body, author: r.author, createdAt: r.createdAt, verdict: r.verdict })
        .onConflictDoNothing()
        .run();
      report.reviews++;
    }
  }

  // reading state
  if (hasReading) {
    const file = readReadingFile(join(home, "reading-state.json"));
    for (const [id, e] of Object.entries(file.docs)) {
      if (!ids.has(id)) {
        db.insert(documents)
          .values({ id, path: null, createdAt: e.readAt, openedAt: e.readAt, kind: null })
          .onConflictDoNothing()
          .run();
        ids.add(id);
        report.documents++;
      }
      db.insert(readingState)
        .values({ documentId: id, status: e.status, progress: e.progress, readAt: e.readAt, sourceMtime: e.sourceMtime })
        .onConflictDoUpdate({ target: readingState.documentId, set: { status: e.status, progress: e.progress, readAt: e.readAt, sourceMtime: e.sourceMtime } })
        .run();
      report.readingState++;
    }
  }

  // agent bindings
  if (hasAgents) {
    const file = readAgentsFile(home);
    for (const b of file.agents) {
      if (!ids.has(b.session)) {
        db.insert(documents)
          .values({ id: b.session, path: b.path, createdAt: b.boundAt, openedAt: b.lastSeenAt, kind: null })
          .onConflictDoNothing()
          .run();
        ids.add(b.session);
        report.documents++;
      }
      db.insert(agents)
        .values({ session: b.session, path: b.path, piSession: b.piSession, url: b.url, boundAt: b.boundAt, lastSeenAt: b.lastSeenAt })
        .onConflictDoUpdate({ target: agents.session, set: { path: b.path, piSession: b.piSession, url: b.url, boundAt: b.boundAt, lastSeenAt: b.lastSeenAt } })
        .run();
      report.agents++;
    }
  }

  report.nothing = report.documents + report.comments + report.reviews + report.readingState + report.agents === 0;
  return report;
};

/**
 * Migrate `home`, or dry-run it. Dry runs execute the same inserts against a throwaway
 * database in a temp dir — real parse, real FK checks, nothing on disk renamed.
 */
export const migrate = (
  home: string,
  options: { dry?: boolean } = {},
): Effect.Effect<MigrateReport, IoFailure | LockTimeout | DbFailure, Db | Lock> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const lock = yield* Lock;
    const dry = options.dry === true;
    // dry-runs write to a temp db; real runs take the dedicated migrate lock on the real one
    const target = dry ? mkdtempSync(join(tmpdir(), "bb-migrate-dry-")) : home;
    const work = dry ? Effect.succeed(target) : lock.withLock(join(home, "blackboard.db.migrate.lock"), Effect.succeed(home));
    return yield* work.pipe(
      Effect.flatMap((dir) =>
        db.withTransaction(dir, (d) => insert(d, home)).pipe(
          Effect.map((report) => {
            if (dry) return { ...report, dry: true };
            // rename sources only after the transaction committed
            const renamed: string[] = [];
            const src = sources(home);
            const candidates = [src.registry, ...src.comments, src.reading, src.agents];
            for (const p of candidates) {
              if (existsSync(p)) {
                renameSync(p, `${p}.migrated`);
                renamed.push(p);
              }
            }
            return { ...report, renamed };
          }),
        ),
      ),
      Effect.mapError((e) => ("message" in e ? e : failure(e))),
    );
  });

/** What `db stats` prints: row counts per table plus the db file's size. */
export const stats = (home: string): Effect.Effect<{ path: string; tables: Record<string, number>; bytes: number }, DbFailure, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.raw(home, (raw) => {
      const tables: Record<string, number> = {};
      for (const name of ["documents", "blocks", "comments", "reviews", "reading_state", "agents"]) {
        tables[name] = (raw.query(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;
      }
      const p = join(home, "blackboard.db");
      return { path: p, tables, bytes: existsSync(p) ? statSync(p).size : 0 };
    });
  });

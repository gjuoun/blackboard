import { existsSync, readFileSync } from "node:fs";
import { Safe } from "@gjuoun/safe-ts";
import type { ReadingStateRepo, ReadingStateRow } from "./db/repos/reading-state";
import type { DbFailure } from "./errors";
import { clampProgress, isReadingStatus, type ReadingEntry } from "./reading-model";

/**
 * Reading state lived in `~/.blackboard/reading-state.json`; since the data-layer round it is the
 * `reading_state` table, one row per document id. The JSON file is only migration input. The
 * `ReadingFile`/`ReadingEntry` shapes stay — `effectiveEntry` and the workspace model consume them
 * unchanged.
 */
export type ReadingFile = { version: 1; docs: Record<string, ReadingEntry> };

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** One stored record, or null when it is not a record this version understands. */
function entryOf(v: unknown): ReadingEntry | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  // A record written before the third state retired still says "reading": migrate it as read, never
  // drop it, or a reader loses every document they had started.
  const status = o.status === "reading" ? "read" : o.status;
  if (!isReadingStatus(status)) return null;
  return {
    status,
    progress: clampProgress(o.progress),
    readAt: isTime(o.readAt) ? o.readAt : new Date(0).toISOString(),
    sourceMtime: typeof o.sourceMtime === "number" && Number.isFinite(o.sourceMtime) ? o.sourceMtime : 0,
  };
}

/** The state file as a value — migration source; a missing file is empty, one that does not parse is an error. */
export function readReadingState(p: string): ReadingFile {
  if (!existsSync(p)) return { version: 1, docs: {} };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || typeof data.docs !== "object" || data.docs === null)
    throw new Error(`unsupported reading state: ${p}`);
  const docs: Record<string, ReadingEntry> = {};
  for (const [id, raw] of Object.entries(data.docs)) {
    const entry = entryOf(raw);
    if (entry) docs[id] = entry;
  }
  return { version: 1, docs };
}

const toRow = (documentId: string, e: ReadingEntry): ReadingStateRow => ({
  documentId,
  status: e.status,
  progress: e.progress,
  readAt: e.readAt,
  sourceMtime: e.sourceMtime,
});

const toEntry = (r: ReadingStateRow): ReadingEntry => ({
  // A row written before the third state retired says "reading"; it reads as read.
  status: ((r.status as string) === "reading" ? "read" : r.status) as ReadingEntry["status"],
  progress: r.progress,
  readAt: r.readAt,
  sourceMtime: r.sourceMtime,
});

/** The reading state store, backed by the reading_state table. */
export class ReadingStateStore {
  constructor(private readonly repo: ReadingStateRepo) {}

  /** Every stored entry as a ReadingFile-shaped map. */
  read(home: string): Safe<ReadingFile, DbFailure> {
    const repo = this.repo;
    return Safe.try(function* () {
      const rows = (yield repo.list(home)) as ReadingStateRow[];
      const docs: Record<string, ReadingEntry> = {};
      for (const r of rows) docs[r.documentId] = toEntry(r);
      return { version: 1 as const, docs };
    });
  }

  /** Upsert one document's entry. */
  set(home: string, documentId: string, entry: ReadingEntry): Safe<void, DbFailure> {
    const repo = this.repo;
    return Safe.try(function* () {
      yield repo.set(home, toRow(documentId, entry));
    });
  }
}
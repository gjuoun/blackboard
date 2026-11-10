import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ReadingStateRepo, type ReadingStateRow } from "./db/repos/reading-state";
import type { DbFailure } from "./effect/errors";
import { clampProgress, isReadingStatus, type ReadingEntry } from "./reading-model";

/**
 * Reading state lived in `~/.blackboard/reading-state.json`; since the data-layer round it is the
 * `reading_state` table, one row per document id. The JSON file is only migration input. The
 * `ReadingFile`/`ReadingEntry` shapes stay — `effectiveEntry` and the workspace model consume
 * them unchanged.
 */
export type ReadingFile = { version: 1; docs: Record<string, ReadingEntry> };

/** `<home>/reading-state.json` — the migration source only. */
export const readingStatePath = (home: string) => join(home, "reading-state.json");

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** One stored record, or null when it is not a record this version understands. */
function entryOf(v: unknown): ReadingEntry | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isReadingStatus(o.status)) return null;
  return {
    status: o.status,
    progress: clampProgress(o.progress),
    readAt: isTime(o.readAt) ? o.readAt : new Date(0).toISOString(),
    sourceMtime: typeof o.sourceMtime === "number" && Number.isFinite(o.sourceMtime) ? o.sourceMtime : 0,
  };
}

/** The state file as a value — migration source; a missing file is empty, a file that does not parse is an error. */
export function readReadingState(p: string): ReadingFile {
  if (!existsSync(p)) return { version: 1, docs: {} };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || typeof data.docs !== "object" || data.docs === null) throw new Error(`unsupported reading state: ${p}`);
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
  status: r.status,
  progress: r.progress,
  readAt: r.readAt,
  sourceMtime: r.sourceMtime,
});

/** The reading state store, backed by the reading_state table. */
export class ReadingStateStore extends Context.Service<
  ReadingStateStore,
  {
    /** Every stored entry as a ReadingFile-shaped map. */
    read(home: string): Effect.Effect<ReadingFile, DbFailure>;
    /** Upsert one document's entry. */
    set(home: string, documentId: string, entry: ReadingEntry): Effect.Effect<void, DbFailure>;
  }
>()("blackboard/ReadingStateStore") {}

export const layer = Layer.effect(
  ReadingStateStore,
  Effect.gen(function* () {
    const repo = yield* ReadingStateRepo;
    return ReadingStateStore.of({
      read: (home) =>
        repo.list(home).pipe(
          Effect.map((rows) => {
            const docs: Record<string, ReadingEntry> = {};
            for (const r of rows) docs[r.documentId] = toEntry(r);
            return { version: 1 as const, docs };
          }),
        ),
      set: (home, documentId, entry) => repo.set(home, toRow(documentId, entry)).pipe(Effect.asVoid),
    });
  }),
);

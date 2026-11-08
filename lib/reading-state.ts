import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import { errorMessage, IoFailure, type LockTimeout } from "./effect/errors";
import { Lock } from "./lock";
import { clampProgress, isReadingStatus, type ReadingEntry } from "./reading-model";

/**
 * Reading state is `~/.blackboard/reading-state.json`: one record per session id, next to the
 * session registry, so it survives a server restart without touching `sessions.json`'s schema.
 * Plain JSON on purpose: a person or an agent can read it from disk.
 */
export type ReadingFile = { version: 1; docs: Record<string, ReadingEntry> };

/** `<home>/reading-state.json`. */
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

/** The state file as a value; a missing file is empty, a file that does not parse is an error. */
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

function writeAtomic(p: string, data: ReadingFile) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, p);
}

const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/**
 * The reading state store: read, change and write the one state file. Same discipline as the
 * comment file store — an in-process semaphore plus the cross-process file lock hold the whole
 * read-change-write, because `node:fs` sync calls yield nothing between the read and the write.
 */
export class ReadingStateStore extends Context.Service<
  ReadingStateStore,
  {
    read(home: string): Effect.Effect<ReadingFile, IoFailure>;
    mutate<A>(home: string, change: (file: ReadingFile) => A): Effect.Effect<A, IoFailure | LockTimeout>;
  }
>()("blackboard/ReadingStateStore") {}

export const layer = Layer.effect(
  ReadingStateStore,
  Effect.gen(function* () {
    const lock = yield* Lock;
    const gate = yield* Semaphore.make(1);
    const read = (home: string) => Effect.try({ try: () => readReadingState(readingStatePath(home)), catch: failure });
    const mutate = <A>(home: string, change: (file: ReadingFile) => A): Effect.Effect<A, IoFailure | LockTimeout> => {
      const path = readingStatePath(home);
      return gate.withPermits(1)(
        lock.withLock(
          path,
          Effect.gen(function* () {
            const current = yield* read(home);
            const result = yield* Effect.try({ try: () => change(current), catch: failure });
            yield* Effect.try({ try: () => writeAtomic(path, current), catch: failure });
            return result;
          }),
        ),
      );
    };
    return ReadingStateStore.of({ read, mutate });
  }),
);

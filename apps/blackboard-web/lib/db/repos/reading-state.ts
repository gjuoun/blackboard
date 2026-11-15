import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { Db } from "../client";
import { readingState } from "../schema";
import type { DbFailure } from "../../effect/errors";

export type ReadingStateRow = typeof readingState.$inferSelect;

/** The reading_state table: one row per document, keyed by document id. */
export class ReadingStateRepo extends Context.Service<
  ReadingStateRepo,
  {
    get(home: string, documentId: string): Effect.Effect<ReadingStateRow | null, DbFailure>;
    set(home: string, row: ReadingStateRow): Effect.Effect<ReadingStateRow, DbFailure>;
    remove(home: string, documentId: string): Effect.Effect<ReadingStateRow | null, DbFailure>;
    list(home: string): Effect.Effect<ReadingStateRow[], DbFailure>;
  }
>()("blackboard/ReadingStateRepo") {}

export const layer = Layer.effect(
  ReadingStateRepo,
  Effect.gen(function* () {
    const db = yield* Db;
    return ReadingStateRepo.of({
      get: (home, documentId) =>
        db.use(home, (d) => d.select().from(readingState).where(eq(readingState.documentId, documentId)).get() ?? null),
      set: (home, row) =>
        db.use(home, (d) => {
          d.insert(readingState).values(row).onConflictDoUpdate({ target: readingState.documentId, set: row }).run();
          return row;
        }),
      remove: (home, documentId) =>
        db.use(home, (d) => {
          const found = d.select().from(readingState).where(eq(readingState.documentId, documentId)).get() ?? null;
          if (found) d.delete(readingState).where(eq(readingState.documentId, documentId)).run();
          return found;
        }),
      list: (home) => db.use(home, (d) => d.select().from(readingState).all()),
    });
  }),
);

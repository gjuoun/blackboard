import type { Safe } from "@gjuoun/safe-ts";
import { eq } from "drizzle-orm";
import { run, services } from "../../../test/app";
import type { DbFailure } from "../../errors";
import type { Db } from "../client";
import { readingState } from "../schema";

export type ReadingStateRow = typeof readingState.$inferSelect;

/** The reading_state table: one row per document, keyed by document id. */
export class ReadingStateRepo {
  constructor(private readonly db: Db) {}

  get(home: string, documentId: string): Safe<ReadingStateRow | null, DbFailure> {
    return this.db.use(
      home,
      (d) => d.select().from(readingState).where(eq(readingState.documentId, documentId)).get() ?? null,
    );
  }

  set(home: string, row: ReadingStateRow): Safe<ReadingStateRow, DbFailure> {
    return this.db.use(home, (d) => {
      d.insert(readingState)
        .values(row)
        .onConflictDoUpdate({ target: readingState.documentId, set: row })
        .run();
      return row;
    });
  }

  remove(home: string, documentId: string): Safe<ReadingStateRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const found =
        d.select().from(readingState).where(eq(readingState.documentId, documentId)).get() ?? null;
      if (found) d.delete(readingState).where(eq(readingState.documentId, documentId)).run();
      return found;
    });
  }

  list(home: string): Safe<ReadingStateRow[], DbFailure> {
    return this.db.use(home, (d) => d.select().from(readingState).all());
  }
}

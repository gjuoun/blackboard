import { Safe } from "@gjuoun/safe-ts";
import { and, eq, isNull } from "drizzle-orm";
import type { DbFailure } from "../../errors";
import type { Db } from "../client";
import { documents } from "../schema";

/** A registered document row (the old sessions.json record). */
export type DocRow = typeof documents.$inferSelect;

const now = () => new Date().toISOString();

/** The documents table: sessions in the new model. */
export class DocumentsRepo {
  constructor(private readonly db: Db) {}

  /** Register or re-open: same id gets a fresh openedAt (and un-closes), everything else keeps. */
  upsert(
    home: string,
    input: { id: string; path: string | null; kind?: string | null },
  ): Safe<DocRow, DbFailure> {
    return this.db.use(home, (d) => {
      const t = now();
      d.insert(documents)
        .values({
          id: input.id,
          path: input.path,
          kind: input.kind ?? null,
          createdAt: t,
          openedAt: t,
          closedAt: null,
        })
        .onConflictDoUpdate({
          target: documents.id,
          set: { path: input.path, kind: input.kind ?? null, openedAt: t, closedAt: null },
        })
        .run();
      return d.select().from(documents).where(eq(documents.id, input.id)).get()!;
    });
  }

  /** The open (unclosed) row for an id. */
  get(home: string, id: string): Safe<DocRow | null, DbFailure> {
    return this.db.use(
      home,
      (d) =>
        d
          .select()
          .from(documents)
          .where(and(eq(documents.id, id), isNull(documents.closedAt)))
          .get() ?? null,
    );
  }

  /** Every open row, closed ones excluded. */
  list(home: string): Safe<DocRow[], DbFailure> {
    return this.db.use(home, (d) => d.select().from(documents).where(isNull(documents.closedAt)).all());
  }

  /** Close the session: marks the row, keeps it — its comments and bindings must survive. */
  remove(home: string, id: string): Safe<DocRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const found =
        d
          .select()
          .from(documents)
          .where(and(eq(documents.id, id), isNull(documents.closedAt)))
          .get() ?? null;
      if (!found) return null;
      d.update(documents).set({ closedAt: now() }).where(eq(documents.id, id)).run();
      return found;
    });
  }

  touch(home: string, id: string): Safe<void, DbFailure> {
    return this.db.use(home, (d) => {
      d.update(documents).set({ openedAt: now() }).where(eq(documents.id, id)).run();
    });
  }
}
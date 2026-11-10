import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { Db } from "../client";
import { documents } from "../schema";
import type { DbFailure } from "../../effect/errors";

/** A registered document row (the old sessions.json record). */
export type DocRow = typeof documents.$inferSelect;

const now = () => new Date().toISOString();

/** The documents table: sessions in the new model. Sync Drizzle calls, Effect-wrapped like every store. */
export class DocumentsRepo extends Context.Service<
  DocumentsRepo,
  {
    /** Register or re-open: same id gets a fresh openedAt, everything else keeps. */
    upsert(home: string, input: { id: string; path: string | null; kind?: string | null }): Effect.Effect<DocRow, DbFailure>;
    get(home: string, id: string): Effect.Effect<DocRow | null, DbFailure>;
    list(home: string): Effect.Effect<DocRow[], DbFailure>;
    /** Remove the session row; children cascade away with it. */
    remove(home: string, id: string): Effect.Effect<DocRow | null, DbFailure>;
    touch(home: string, id: string): Effect.Effect<void, DbFailure>;
  }
>()("blackboard/DocumentsRepo") {}

export const layer = Layer.effect(
  DocumentsRepo,
  Effect.gen(function* () {
    const db = yield* Db;
    const get = (home: string, id: string) =>
      db.use(home, (d) => d.select().from(documents).where(eq(documents.id, id)).get() ?? null);
    return DocumentsRepo.of({
      get,
      list: (home) => db.use(home, (d) => d.select().from(documents).all()),
      upsert: (home, input) =>
        db.use(home, (d) => {
          const t = now();
          d.insert(documents)
            .values({ id: input.id, path: input.path, kind: input.kind ?? null, createdAt: t, openedAt: t })
            .onConflictDoUpdate({ target: documents.id, set: { path: input.path, kind: input.kind ?? null, openedAt: t } })
            .run();
          return d.select().from(documents).where(eq(documents.id, input.id)).get()!;
        }),
      remove: (home, id) =>
        db.use(home, (d) => {
          const found = d.select().from(documents).where(eq(documents.id, id)).get() ?? null;
          if (found) d.delete(documents).where(eq(documents.id, id)).run();
          return found;
        }),
      touch: (home, id) =>
        db.use(home, (d) => void d.update(documents).set({ openedAt: now() }).where(eq(documents.id, id)).run()),
    });
  }),
);

import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { asc, eq, max } from "drizzle-orm";
import { Db } from "../client";
import { blocks } from "../schema";
import type { DbFailure } from "../../effect/errors";

/** One exchange of the reply-style stream (unpopulated this round; the stream UI appends these). */
export type BlockRow = typeof blocks.$inferSelect;
export type BlockInput = Omit<BlockRow, "id" | "n">;

const newId = () => `b_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/** The blocks table: append-only exchanges, `n` assigned by next(). */
export class BlocksRepo extends Context.Service<
  BlocksRepo,
  {
    /** The next exchange number for the document (1-based; 1 when empty). */
    next(home: string, documentId: string): Effect.Effect<number, DbFailure>;
    append(home: string, block: BlockInput): Effect.Effect<BlockRow, DbFailure>;
    list(home: string, documentId: string): Effect.Effect<BlockRow[], DbFailure>;
  }
>()("blackboard/BlocksRepo") {}

export const layer = Layer.effect(
  BlocksRepo,
  Effect.gen(function* () {
    const db = yield* Db;
    const next = (home: string, documentId: string) =>
      db.use(home, (d) => (d.select({ n: max(blocks.n) }).from(blocks).where(eq(blocks.documentId, documentId)).get()?.n ?? 0) + 1);
    return BlocksRepo.of({
      next,
      append: (home, block) =>
        db.use(home, (d) => {
          const row: BlockRow = { id: newId(), n: (d.select({ n: max(blocks.n) }).from(blocks).where(eq(blocks.documentId, block.documentId)).get()?.n ?? 0) + 1, ...block };
          d.insert(blocks).values(row).run();
          return row;
        }),
      list: (home, documentId) =>
        db.use(home, (d) => d.select().from(blocks).where(eq(blocks.documentId, documentId)).orderBy(asc(blocks.n)).all()),
    });
  }),
);

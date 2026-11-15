import { eq, max } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Db } from "./db/client";
import { blocks, documents } from "./db/schema";
import { applyReconcile } from "./db/repos/content-blocks";
import { DbFailure, InvalidInput, SessionNotFound } from "./effect/errors";
import type { Session } from "./session-model";
import { exportStream, foldBlocks, type StreamBlock, type StreamAction } from "./stream-doc";
import { ulid } from "./ulid";

/**
 * The streamed document store: one documents row (kind "stream", no path) plus its exchange
 * blocks. Every write happens inside one database pass — the block row lands, then the running
 * `documents.body` is refolded from the whole block list, so the markdown view and the block
 * view can never drift. bun:sqlite is synchronous and single-connection per home, so `n` is
 * assigned inside the same pass and two writers cannot collide.
 */

export type StreamFailure = DbFailure | InvalidInput | SessionNotFound;

/** What `append` / `edit` need; a bad value is refused by the caller's schema first. */
export type BlockInput = { action: StreamAction; body: string; author: string; images?: string[]; status?: "writing" };

/** One row as the stream model reads it (the drizzle row minus the document id). */
const toBlock = (row: typeof blocks.$inferSelect): StreamBlock => ({
  id: row.id,
  n: row.n,
  action: row.action,
  author: row.author,
  body: row.body,
  images: row.images ?? undefined,
  status: row.status === "writing" ? "writing" : null,
  at: row.at,
});

/** The session id a streamed document gets: `s-` plus a ULID, sortable by creation time. */
const streamId = () => `s-${ulid()}`;

const notAStream = (id: string) => new InvalidInput({ message: `${id} is not a stream`, status: 400 });
const noBlock = (id: string) => new InvalidInput({ message: `no block ${id} in this stream`, status: 400 });

export class StreamsStore extends Context.Service<
  StreamsStore,
  {
    /** Register a streamed document. Id `s-<ulid>`, no path; the row counts as indexed so the file index never touches it. */
    create(home: string, title: string): Effect.Effect<Session, StreamFailure>;
    /** Append one exchange; a `writing` status on an earlier block is closed by the new one. */
    append(home: string, sessionId: string, input: BlockInput): Effect.Effect<StreamBlock, StreamFailure>;
    /** Rewrite one block's body in place (n and id stay); the document view is refolded after it. */
    edit(home: string, sessionId: string, blockId: string, body: string, status?: "writing"): Effect.Effect<StreamBlock, StreamFailure>;
    /** Every exchange of the stream, in order. */
    blocks(home: string, sessionId: string): Effect.Effect<StreamBlock[], StreamFailure>;
    /** The stream's header: title, owner (the first block's author), creation time, block count, open writer. */
    header(home: string, sessionId: string): Effect.Effect<{ id: string; title: string | null; owner: string | null; createdAt: string; blocks: number; writing: boolean }, StreamFailure>;
    /** Rename the stream. */
    setTitle(home: string, sessionId: string, title: string): Effect.Effect<void, StreamFailure>;
    /** The markdown export: one section per exchange. */
    export(home: string, sessionId: string): Effect.Effect<string, StreamFailure>;
    /** The refolded document body, as `documents.body` carries it. */
    body(home: string, sessionId: string): Effect.Effect<string | null, StreamFailure>;
  }
>()("blackboard/StreamsStore") {}

export const layer = Layer.effect(
  StreamsStore,
  Effect.gen(function* () {
    const db = yield* Db;

    /** The open stream row for an id, or why not. */
    const streamRow = (home: string, id: string): Effect.Effect<typeof documents.$inferSelect, StreamFailure> =>
      db.use(home, (d) => d.select().from(documents).where(eq(documents.id, id)).get() ?? null).pipe(
        Effect.flatMap((row): Effect.Effect<typeof documents.$inferSelect, SessionNotFound | InvalidInput> =>
          row === null
            ? Effect.fail(new SessionNotFound({ message: "unknown session", status: 400 }))
            : row.kind !== "stream"
              ? Effect.fail(notAStream(id))
              : Effect.succeed(row),
        ),
      );

    const list = (home: string, documentId: string) =>
      db.use(home, (d) => d.select().from(blocks).where(eq(blocks.documentId, documentId)).orderBy(blocks.n).all()).pipe(
        Effect.map((rows) => rows.map(toBlock)),
      );

    /**
     * Refold and store the document body inside the caller's `db.use` transaction context — the
     * same synchronous pass that just wrote the block, so no read can ever see one without the other.
     */
    const syncBody = (d: Parameters<Parameters<typeof db.use>[1]>[0], documentId: string) => {
      const rows = d.select().from(blocks).where(eq(blocks.documentId, documentId)).orderBy(blocks.n).all();
      const body = foldBlocks(rows.map(toBlock));
      d.update(documents).set({ body, indexedAt: new Date().toISOString() }).where(eq(documents.id, documentId)).run();
      // Content blocks fold in the same pass: ids survive the refold, comments keep their anchor.
      applyReconcile(d, documentId, body);
      return body;
    };

    return StreamsStore.of({
      create: (home, title) =>
        Effect.gen(function* () {
          const id = streamId();
          const at = new Date().toISOString();
          yield* db.use(home, (d) => {
            d.insert(documents)
              .values({ id, path: null, createdAt: at, openedAt: at, kind: "stream", title, body: "", srcSize: 0, indexedAt: at })
              .run();
          });
          return { id, path: "", createdAt: at, openedAt: at, kind: "stream" } satisfies Session;
        }),
      append: (home, sessionId, input) =>
        Effect.gen(function* () {
          yield* streamRow(home, sessionId);
          if (!input.body.trim()) return yield* new InvalidInput({ message: "block text is empty", status: 400, field: "body" });
          return yield* db.use(home, (d) => {
            const n = (d.select({ n: max(blocks.n) }).from(blocks).where(eq(blocks.documentId, sessionId)).get()?.n ?? 0) + 1;
            // A new exchange closes the open one: at most the last block may still be writing.
            d.update(blocks).set({ status: null }).where(eq(blocks.documentId, sessionId)).run();
            const row: typeof blocks.$inferSelect = {
              id: `b-${ulid()}`,
              documentId: sessionId,
              n,
              action: input.action,
              author: input.author,
              body: input.body,
              images: input.images ?? null,
              status: input.status === "writing" ? "writing" : null,
              at: new Date().toISOString(),
            };
            d.insert(blocks).values(row).run();
            syncBody(d, sessionId);
            return toBlock(row);
          });
        }),
      edit: (home, sessionId, blockId, body, status) =>
        Effect.gen(function* () {
          yield* streamRow(home, sessionId);
          if (!body.trim()) return yield* new InvalidInput({ message: "block text is empty", status: 400, field: "body" });
          const result = yield* db.use(home, (d): StreamBlock | InvalidInput => {
            const row = d.select().from(blocks).where(eq(blocks.id, blockId)).get();
            if (!row || row.documentId !== sessionId) return noBlock(blockId);
            const lastN = d.select({ n: max(blocks.n) }).from(blocks).where(eq(blocks.documentId, sessionId)).get()?.n ?? 0;
            if (status === "writing" && row.n !== lastN) {
              return new InvalidInput({ message: "--status writing only applies to the last block", status: 400, field: "status" });
            }
            const at = new Date().toISOString();
            d.update(blocks).set({ body, status: status === "writing" ? "writing" : null, at }).where(eq(blocks.id, blockId)).run();
            syncBody(d, sessionId);
            return toBlock({ ...row, body, status: status === "writing" ? "writing" : null, at });
          });
          if (result instanceof InvalidInput) return yield* result;
          return result;
        }),
      blocks: (home, sessionId) => Effect.andThen(streamRow(home, sessionId), () => list(home, sessionId)),
      header: (home, sessionId) =>
        Effect.gen(function* () {
          const row = yield* streamRow(home, sessionId);
          const all = yield* list(home, sessionId);
          return {
            id: sessionId,
            title: row.title,
            owner: all[0]?.author ?? null,
            createdAt: row.createdAt,
            blocks: all.length,
            writing: all[all.length - 1]?.status === "writing",
          };
        }),
      setTitle: (home, sessionId, title) =>
        Effect.gen(function* () {
          yield* streamRow(home, sessionId);
          yield* db.use(home, (d) => void d.update(documents).set({ title }).where(eq(documents.id, sessionId)).run());
        }),
      export: (home, sessionId) =>
        Effect.gen(function* () {
          const row = yield* streamRow(home, sessionId);
          const all = yield* list(home, sessionId);
          return exportStream(all, row.title ?? sessionId);
        }),
      body: (home, sessionId) =>
        Effect.gen(function* () {
          yield* streamRow(home, sessionId);
          return yield* db.use(home, (d) => d.select({ body: documents.body }).from(documents).where(eq(documents.id, sessionId)).get()?.body ?? null);
        }),
    });
  }),
);

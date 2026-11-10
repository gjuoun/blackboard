import { Context, Effect, Layer } from "effect";
import { asc, eq } from "drizzle-orm";
import { Db } from "../client";
import { comments, reviews } from "../schema";
import type { DbFailure } from "../../effect/errors";

/** A comment row; `replies` is its flat thread, stored as JSON and always read/written whole. */
export type CommentRow = typeof comments.$inferSelect;
export type CommentInput = Omit<CommentRow, "replies"> & { replies?: CommentRow["replies"] };
export type ReviewRow = typeof reviews.$inferSelect;

const now = () => new Date().toISOString();

/** The comments and reviews tables: one doc's review surface. */
export class CommentsRepo extends Context.Service<
  CommentsRepo,
  {
    add(home: string, input: CommentInput): Effect.Effect<CommentRow, DbFailure>;
    get(home: string, id: string): Effect.Effect<CommentRow | null, DbFailure>;
    list(home: string, documentId: string): Effect.Effect<CommentRow[], DbFailure>;
    setStatus(home: string, id: string, status: "open" | "resolved", by: string): Effect.Effect<CommentRow | null, DbFailure>;
    addReply(home: string, id: string, reply: { id: string; body: string; author: string }): Effect.Effect<CommentRow | null, DbFailure>;
    update(home: string, id: string, body: string): Effect.Effect<CommentRow | null, DbFailure>;
    /** Whole-row rewrite for changes that are not a body edit: replies, status fields. */
    updateRow(home: string, row: CommentRow): Effect.Effect<CommentRow | null, DbFailure>;
    remove(home: string, id: string): Effect.Effect<CommentRow | null, DbFailure>;
    addReview(home: string, review: ReviewRow): Effect.Effect<ReviewRow, DbFailure>;
    listReviews(home: string, documentId: string): Effect.Effect<ReviewRow[], DbFailure>;
  }
>()("blackboard/CommentsRepo") {}

export const layer = Layer.effect(
  CommentsRepo,
  Effect.gen(function* () {
    const db = yield* Db;
    const get = (home: string, id: string) =>
      db.use(home, (d) => d.select().from(comments).where(eq(comments.id, id)).get() ?? null);
    return CommentsRepo.of({
      get,
      add: (home, input) =>
        db.use(home, (d) => {
          const row: CommentRow = { ...input, replies: input.replies ?? [] };
          d.insert(comments).values(row).run();
          return row;
        }),
      list: (home, documentId) =>
        db.use(home, (d) => d.select().from(comments).where(eq(comments.documentId, documentId)).orderBy(asc(comments.createdAt)).all()),
      setStatus: (home, id, status, by) =>
        db.use(home, (d) => {
          const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
          if (!c) return null;
          const patch = status === "resolved"
            ? { status, resolvedAt: now(), resolvedBy: by }
            : { status, resolvedAt: null, resolvedBy: null, ...(c.resolvedAt ? { reopenedAt: now(), reopenedBy: by } : {}) };
          d.update(comments).set(patch).where(eq(comments.id, id)).run();
          return { ...c, ...patch };
        }),
      addReply: (home, id, reply) =>
        db.use(home, (d) => {
          const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
          if (!c) return null;
          const replies = [...c.replies, { ...reply, createdAt: now() }];
          d.update(comments).set({ replies }).where(eq(comments.id, id)).run();
          return { ...c, replies };
        }),
      update: (home, id, body) =>
        db.use(home, (d) => {
          const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
          if (!c) return null;
          d.update(comments).set({ body, editedAt: now() }).where(eq(comments.id, id)).run();
          return { ...c, body, editedAt: now() };
        }),
      updateRow: (home, row) =>
        db.use(home, (d) => {
          const found = d.select().from(comments).where(eq(comments.id, row.id)).get() ?? null;
          if (!found) return null;
          d.update(comments).set(row).where(eq(comments.id, row.id)).run();
          return row;
        }),
      remove: (home, id) =>
        db.use(home, (d) => {
          const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
          if (c) d.delete(comments).where(eq(comments.id, id)).run();
          return c;
        }),
      addReview: (home, review) =>
        db.use(home, (d) => {
          d.insert(reviews).values(review).run();
          return review;
        }),
      listReviews: (home, documentId) =>
        db.use(home, (d) => d.select().from(reviews).where(eq(reviews.documentId, documentId)).orderBy(asc(reviews.createdAt)).all()),
    });
  }),
);

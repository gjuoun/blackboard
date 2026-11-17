import type { Safe } from "@gjuoun/safe-ts";
import { asc, eq } from "drizzle-orm";
import type { DbFailure } from "../../errors";
import type { Db } from "../client";
import { comments } from "../schema";

/** A comment row; `replies` is its flat thread, stored as JSON and always read/written whole. */
export type CommentRow = typeof comments.$inferSelect;
export type CommentInput = Omit<CommentRow, "replies"> & { replies?: CommentRow["replies"] };
const now = () => new Date().toISOString();

/** The comments table: one doc's review surface. */
export class CommentsRepo {
  constructor(private readonly db: Db) {}

  get(home: string, id: string): Safe<CommentRow | null, DbFailure> {
    return this.db.use(home, (d) => d.select().from(comments).where(eq(comments.id, id)).get() ?? null);
  }

  add(home: string, input: CommentInput): Safe<CommentRow, DbFailure> {
    return this.db.use(home, (d) => {
      const row: CommentRow = { ...input, replies: input.replies ?? [] };
      d.insert(comments).values(row).run();
      return row;
    });
  }

  list(home: string, documentId: string): Safe<CommentRow[], DbFailure> {
    return this.db.use(home, (d) =>
      d
        .select()
        .from(comments)
        .where(eq(comments.documentId, documentId))
        .orderBy(asc(comments.createdAt))
        .all(),
    );
  }

  setStatus(
    home: string,
    id: string,
    status: "open" | "resolved",
    by: string,
  ): Safe<CommentRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
      if (!c) return null;
      const patch =
        status === "resolved"
          ? { status, resolvedAt: now(), resolvedBy: by }
          : {
              status,
              resolvedAt: null,
              resolvedBy: null,
              ...(c.resolvedAt ? { reopenedAt: now(), reopenedBy: by } : {}),
            };
      d.update(comments).set(patch).where(eq(comments.id, id)).run();
      return { ...c, ...patch };
    });
  }

  addReply(
    home: string,
    id: string,
    reply: { id: string; body: string; author: string },
  ): Safe<CommentRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
      if (!c) return null;
      const replies = [...c.replies, { ...reply, createdAt: now() }];
      d.update(comments).set({ replies }).where(eq(comments.id, id)).run();
      return { ...c, replies };
    });
  }

  update(home: string, id: string, body: string): Safe<CommentRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
      if (!c) return null;
      d.update(comments).set({ body, editedAt: now() }).where(eq(comments.id, id)).run();
      return { ...c, body, editedAt: now() };
    });
  }

  /** Whole-row rewrite for changes that are not a body edit: replies, status fields. */
  updateRow(home: string, row: CommentRow): Safe<CommentRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const found = d.select().from(comments).where(eq(comments.id, row.id)).get() ?? null;
      if (!found) return null;
      d.update(comments).set(row).where(eq(comments.id, row.id)).run();
      return row;
    });
  }

  remove(home: string, id: string): Safe<CommentRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const c = d.select().from(comments).where(eq(comments.id, id)).get() ?? null;
      if (c) d.delete(comments).where(eq(comments.id, id)).run();
      return c;
    });
  }
}

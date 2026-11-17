import { Pipe, Safe } from "@gjuoun/safe-ts";
import type { QuoteSelector } from "./anchor";
import type { ChangeBus } from "./change-bus";
import { type Comment, type CommentFile, commentId, replyId } from "./comments-file";
import type { CommentRow, CommentsRepo } from "./db/repos/comments";
import type { ContentBlocksRepo } from "./db/repos/content-blocks";
import { type ApiFailure, failures, IoFailure } from "./errors";

export type { Comment, CommentFile, Reply } from "./comments-file";
export { readComments } from "./comments-file";

/**
 * The comment store, backed by `blackboard.db` (comments + reviews tables). The public model is still
 * the JSON-era `CommentFile` shape — `docs`-keyed comment lists and a reviews list — so nothing on
 * the wire or in the CLI output moves. Reads and writes are whole-row: a comment's reply thread lives
 * in its `replies` column and is always fetched, patched and stored as one.
 */

const now = () => new Date().toISOString();

const toComment = (row: CommentRow): Comment => {
  // Property order is the wire: the JSON file wrote quote/general right after id, and snapshots (and
  // any client diffing raw bodies) see key order. Build it in that order, not row order.
  const c: Comment = { id: row.id } as Comment;
  if (row.anchor === "quote" && row.quote) c.quote = row.quote;
  if (row.anchor === "general") c.general = true;
  c.body = row.body;
  if (row.images?.length) c.images = row.images;
  c.author = row.author;
  c.createdAt = row.createdAt;
  c.status = row.status as Comment["status"];
  c.replies = row.replies;
  if (row.editedAt) c.editedAt = row.editedAt;
  if (row.resolvedAt) {
    c.resolvedAt = row.resolvedAt;
    c.resolvedBy = row.resolvedBy ?? undefined;
  }
  if (row.reopenedAt) {
    c.reopenedAt = row.reopenedAt;
    c.reopenedBy = row.reopenedBy ?? undefined;
  }
  return c;
};

export type Anchor = { quote: QuoteSelector } | { general: true };

const notFound = (id: string, doc?: string) =>
  failures.IoFailure(`comment ${id} not found${doc ? ` in ${doc}` : ""}`, 404);
const replyNotFound = (id: string, cId: string) => failures.IoFailure(`reply ${id} not found on ${cId}`, 404);

/** A block lookup that may fail is worth "no block": the comment still answers. */
const orNull = <A>(safe: Safe<A, unknown>) =>
  Safe.pipe(
    safe,
    Pipe.catchTag("DbFailure", () => Safe.ok(null as A | null)),
  ) as unknown as Safe<A | null, never>;

/** The comment store: one document's review surface, read and written whole. */
export class CommentsStore {
  constructor(
    private readonly repo: CommentsRepo,
    private readonly contentBlocks: ContentBlocksRepo,
    private readonly bus?: ChangeBus,
  ) {}

  private mark(row: { documentId: string }): void {
    this.bus?.publish(row.documentId);
  }

  private row(home: string, id: string, doc: string): Safe<CommentRow, ApiFailure> {
    const repo = this.repo;
    return Safe.try(function* () {
      const found = (yield repo.get(home, id)) as CommentRow | null;
      if (found) return found;
      return (yield Safe.err(notFound(id, doc))) as never;
    });
  }

  /** Whole-row rewrite: read-modify-write happens through the repo's per-row update path. */
  private save(home: string, row: CommentRow): Safe<CommentRow, ApiFailure> {
    const repo = this.repo;
    return Safe.try(function* () {
      const saved = (yield repo.updateRow(home, row)) as CommentRow | null;
      if (saved) return saved;
      return (yield Safe.err(notFound(row.id))) as never;
    });
  }

  /**
   * The comment as the wire carries it, with its block's present state folded in. `block` is only
   * attached when the block moved or died — a current anchor adds nothing but id churn.
   */
  private withBlock(home: string, row: CommentRow): Safe<Comment, ApiFailure> {
    const blocks = this.contentBlocks;
    return Safe.try(function* () {
      const c = toComment(row);
      if (!row.blockId || row.blockRev == null) return c;
      const block = (yield blocks.get(home, row.blockId)) as {
        deletedAt: string | null;
        rev: number;
        text: string;
      } | null;
      if (!block) {
        c.block = { id: row.blockId, rev: row.blockRev, state: "deleted" };
        return c;
      }
      if (block.deletedAt) {
        const before = (yield orNull(blocks.revText(home, row.blockId, row.blockRev))) as string | null;
        c.block = { id: row.blockId, rev: row.blockRev, state: "deleted", before: before ?? undefined };
        return c;
      }
      if (block.rev === row.blockRev) return c;
      const before = (yield orNull(blocks.revText(home, row.blockId, row.blockRev))) as string | null;
      c.block = {
        id: row.blockId,
        rev: row.blockRev,
        state: "modified",
        before: before ?? undefined,
        after: block.text,
      };
      return c;
    });
  }

  /** The session's comments as a CommentFile: `docs` keyed by doc basename. */
  read(home: string, sessionId: string): Safe<CommentFile, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const rows = (yield self.repo.list(home, sessionId)) as CommentRow[];
      const docs: Record<string, Comment[]> = {};
      for (const row of rows) {
        const c = (yield self.withBlock(home, row)) as Comment;
        (docs[row.doc] ??= []).push(c);
      }
      return { version: 1, docs };
    });
  }

  /** Open comments across the session — the session row's count. */
  countOpen(home: string, sessionId: string): Safe<number, ApiFailure> {
    const repo = this.repo;
    return Safe.try(function* () {
      const rows = (yield repo.list(home, sessionId)) as CommentRow[];
      return rows.filter((r) => r.status === "open").length;
    });
  }

  /** Every comment on the session with its doc key, in creation order. */
  list(home: string, sessionId: string): Safe<(Comment & { doc: string })[], ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const rows = (yield self.repo.list(home, sessionId)) as CommentRow[];
      const out: (Comment & { doc: string })[] = [];
      for (const r of rows) out.push({ ...((yield self.withBlock(home, r)) as Comment), doc: r.doc });
      return out;
    });
  }

  add(
    home: string,
    sessionId: string,
    doc: string,
    input: Anchor & { body: string; author: string; images?: string[] },
  ): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      // The quote's semantic identity: the live block it landed on, and the block's rev right now.
      // resolveQuote answers null for a quote nothing holds (stays an orphan).
      const resolution = (
        "quote" in input ? yield orNull(self.contentBlocks.resolveQuote(home, sessionId, input.quote)) : null
      ) as { blockId: string; blockRev: number } | null;
      const saved = (yield self.repo.add(home, {
        id: commentId(),
        documentId: sessionId,
        doc,
        anchor: "quote" in input ? "quote" : "general",
        quote: "quote" in input ? input.quote : null,
        blockId: resolution?.blockId ?? null,
        blockRev: resolution?.blockRev ?? null,
        body: input.body,
        images: input.images ?? null,
        author: input.author,
        createdAt: now(),
        editedAt: null,
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        reopenedAt: null,
        reopenedBy: null,
        replies: [],
      })) as CommentRow;
      self.mark({ documentId: sessionId });
      return toComment(saved);
    });
  }

  reply(
    home: string,
    id: string,
    doc: string,
    input: { body: string; author: string; joinReplyId?: string },
  ): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const row = (yield self.row(home, id, doc)) as CommentRow;
      if (input.joinReplyId !== undefined && !row.replies.some((r) => r.id === input.joinReplyId)) {
        return (yield Safe.err(replyNotFound(input.joinReplyId, id))) as never;
      }
      const saved = (yield self.save(home, {
        ...row,
        replies: [
          ...row.replies,
          { id: replyId(), body: input.body, author: input.author, createdAt: now() },
        ],
      })) as CommentRow;
      self.mark(saved);
      return toComment(saved);
    });
  }

  edit(home: string, id: string, doc: string, body: string): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const r = (yield self.repo.update(home, id, body)) as CommentRow | null;
      if (!r) return (yield Safe.err(notFound(id, doc))) as never;
      self.mark(r);
      return toComment(r);
    });
  }

  remove(home: string, id: string, doc: string): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const r = (yield self.repo.remove(home, id)) as CommentRow | null;
      if (!r) return (yield Safe.err(notFound(id, doc))) as never;
      self.mark(r);
      return toComment(r);
    });
  }

  editReply(home: string, id: string, rId: string, doc: string, body: string): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const row = (yield self.row(home, id, doc)) as CommentRow;
      if (!row.replies.some((r) => r.id === rId)) return (yield Safe.err(replyNotFound(rId, id))) as never;
      const replies = row.replies.map((r) => (r.id === rId ? { ...r, body, editedAt: now() } : r));
      const saved = (yield self.save(home, { ...row, replies })) as CommentRow;
      self.mark(saved);
      return toComment(saved);
    });
  }

  deleteReply(home: string, id: string, rId: string, doc: string): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const row = (yield self.row(home, id, doc)) as CommentRow;
      if (!row.replies.some((r) => r.id === rId)) return (yield Safe.err(replyNotFound(rId, id))) as never;
      const saved = (yield self.save(home, {
        ...row,
        replies: row.replies.filter((r) => r.id !== rId),
      })) as CommentRow;
      self.mark(saved);
      return toComment(saved);
    });
  }

  setStatus(
    home: string,
    id: string,
    doc: string,
    status: "open" | "resolved",
    by: string,
  ): Safe<Comment, ApiFailure> {
    const self = this;
    return Safe.try(function* () {
      const r = (yield self.repo.setStatus(home, id, status, by)) as CommentRow | null;
      if (!r) return (yield Safe.err(notFound(id, doc))) as never;
      self.mark(r);
      return toComment(r);
    });
  }
}

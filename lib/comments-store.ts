import { Context, Effect, Layer } from "effect";
import type { QuoteSelector } from "./anchor";
import { commentId, replyId, reviewId, type Comment, type CommentFile, type Review } from "./comments-file";
import { ChangeBus } from "./change-bus";
import { CommentsRepo, type CommentRow, type ReviewRow } from "./db/repos/comments";
import { ContentBlocksRepo } from "./db/repos/content-blocks";
import { IoFailure, type ApiFailure } from "./effect/errors";
export type { Comment, CommentFile, Review, Reply } from "./comments-file";
export { readComments } from "./comments-file";

/**
 * The comment store, now backed by `blackboard.db` (comments + reviews tables). The public model
 * is still the JSON-era `CommentFile` shape — `docs`-keyed comment lists and a reviews list — so
 * nothing on the wire or in the CLI output moves. Reads and writes are whole-row: a comment's
 * reply thread lives in its `replies` column and is always fetched, patched and stored as one.
 */

const now = () => new Date().toISOString();

const toComment = (row: CommentRow): Comment => {
  // Property order is the wire: the JSON file wrote quote/general right after id, and snapshots
  // (and any client diffing raw bodies) see key order. Build it in that order, not row order.
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
  if (row.resolvedAt) { c.resolvedAt = row.resolvedAt; c.resolvedBy = row.resolvedBy ?? undefined; }
  if (row.reopenedAt) { c.reopenedAt = row.reopenedAt; c.reopenedBy = row.reopenedBy ?? undefined; }
  return c;
};

const toReview = (row: ReviewRow): Review => ({
  id: row.id,
  doc: row.doc,
  round: row.round,
  body: row.body,
  author: row.author,
  createdAt: row.createdAt,
  verdict: "commented",
});

type Anchor = { quote: QuoteSelector } | { general: true };

export class CommentsStore extends Context.Service<
  CommentsStore,
  {
    /** The session's comments and reviews as a CommentFile: `docs` keyed by doc basename. */
    read(home: string, sessionId: string): Effect.Effect<CommentFile, ApiFailure>;
    /** Open comments across the session — the session row's count. */
    countOpen(home: string, sessionId: string): Effect.Effect<number, ApiFailure>;
    /** Every comment on the session with its doc key, in creation order. */
    list(home: string, sessionId: string): Effect.Effect<(Comment & { doc: string })[], ApiFailure>;
    add(home: string, sessionId: string, doc: string, input: Anchor & { body: string; author: string; images?: string[] }): Effect.Effect<Comment, ApiFailure>;
    reply(home: string, id: string, doc: string, input: { body: string; author: string; joinReplyId?: string }): Effect.Effect<Comment, ApiFailure>;
    edit(home: string, id: string, doc: string, body: string): Effect.Effect<Comment, ApiFailure>;
    remove(home: string, id: string, doc: string): Effect.Effect<Comment, ApiFailure>;
    editReply(home: string, id: string, rId: string, doc: string, body: string): Effect.Effect<Comment, ApiFailure>;
    deleteReply(home: string, id: string, rId: string, doc: string): Effect.Effect<Comment, ApiFailure>;
    setStatus(home: string, id: string, doc: string, status: "open" | "resolved", by: string): Effect.Effect<Comment, ApiFailure>;
    /** Close a round for one doc; refused while an open comment created after the last review has no agent reply. */
    review(home: string, sessionId: string, doc: string, input: { round: number; body: string; author: string }): Effect.Effect<Review, ApiFailure>;
  }
>()("blackboard/CommentsStore") {}

const notFound = (id: string, doc?: string) => new IoFailure({ message: `comment ${id} not found${doc ? ` in ${doc}` : ""}`, status: 404 });
const replyNotFound = (id: string, cId: string) => new IoFailure({ message: `reply ${id} not found on ${cId}`, status: 404 });

export const layer = Layer.effect(
  CommentsStore,
  Effect.gen(function* () {
    const repo = yield* CommentsRepo;
    const contentBlocks = yield* ContentBlocksRepo;
    const bus = yield* Effect.serviceOption(ChangeBus).pipe(Effect.map((o) => (o._tag === "Some" ? o.value : null)));
    const mark = (row: { documentId: string }) => (bus ? bus.publish(row.documentId) : Effect.void);

    const getRow = (home: string, id: string, doc: string) =>
      repo.get(home, id).pipe(Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.fail(notFound(id, doc)))));

    /** Whole-row rewrite: read-modify-write happens through the repo's per-row update path. */
    const save = (home: string, row: CommentRow) =>
      repo.updateRow(home, row).pipe(Effect.flatMap((saved) => (saved ? Effect.succeed(saved) : Effect.fail(notFound(row.id)))));

    /** The comment as the wire carries it, with its block's present state folded in. `block` is
     *  only attached when the block moved or died — a current anchor adds nothing but id churn. */
    const withBlock = (home: string, row: CommentRow): Effect.Effect<Comment, ApiFailure> =>
      Effect.gen(function* () {
        const c = toComment(row);
        if (!row.blockId || row.blockRev == null) return c;
        const block = yield* contentBlocks.get(home, row.blockId);
        if (!block) {
          c.block = { id: row.blockId, rev: row.blockRev, state: "deleted" };
          return c;
        }
        if (block.deletedAt) {
          const before = yield* contentBlocks.revText(home, row.blockId, row.blockRev).pipe(Effect.orElseSucceed(() => null));
          c.block = { id: row.blockId, rev: row.blockRev, state: "deleted", before: before ?? undefined };
          return c;
        }
        if (block.rev === row.blockRev) return c;
        const before = yield* contentBlocks.revText(home, row.blockId, row.blockRev).pipe(Effect.orElseSucceed(() => null));
        c.block = { id: row.blockId, rev: row.blockRev, state: "modified", before: before ?? undefined, after: block.text };
        return c;
      });

    return CommentsStore.of({
      read: (home, sessionId) =>
        Effect.gen(function* () {
          const rows = yield* repo.list(home, sessionId);
          const revs = yield* repo.listReviews(home, sessionId);
          const docs: Record<string, Comment[]> = {};
          for (const row of rows) (docs[row.doc] ??= []).push(yield* withBlock(home, row));
          const file: CommentFile = { version: 1, docs };
          if (revs.length) file.reviews = revs.map(toReview);
          return file;
        }),
      countOpen: (home, sessionId) =>
        repo.list(home, sessionId).pipe(Effect.map((rows) => rows.filter((r) => r.status === "open").length)),
      list: (home, sessionId) =>
        repo.list(home, sessionId).pipe(Effect.flatMap((rows) => Effect.forEach(rows, (r) => Effect.map(withBlock(home, r), (c) => ({ ...c, doc: r.doc }))))),
      add: (home, sessionId, doc, input) =>
        Effect.gen(function* () {
          // The quote's semantic identity: the live block it landed on, and the block's rev
          // right now. resolveQuote answers null for a quote nothing holds (stays an orphan).
          const resolution = "quote" in input ? yield* contentBlocks.resolveQuote(home, sessionId, input.quote).pipe(Effect.orElseSucceed(() => null)) : null;
          const saved = yield* repo.add(home, {
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
          });
          yield* mark({ documentId: sessionId });
          return toComment(saved);
        }),
      reply: (home, id, doc, input) =>
        Effect.gen(function* () {
          const row = yield* getRow(home, id, doc);
          if (input.joinReplyId !== undefined && !row.replies.some((r) => r.id === input.joinReplyId)) {
            return yield* Effect.fail(replyNotFound(input.joinReplyId, id));
          }
          const saved = yield* save(home, { ...row, replies: [...row.replies, { id: replyId(), body: input.body, author: input.author, createdAt: now() }] });
          yield* mark(saved);
          return toComment(saved);
        }),
      edit: (home, id, doc, body) => repo.update(home, id, body).pipe(Effect.flatMap((r) => (r ? mark(r).pipe(Effect.as(toComment(r))) : Effect.fail(notFound(id, doc))))),
      remove: (home, id, doc) => repo.remove(home, id).pipe(Effect.flatMap((r) => (r ? mark(r).pipe(Effect.as(toComment(r))) : Effect.fail(notFound(id, doc))))),
      editReply: (home, id, rId, doc, body) =>
        Effect.gen(function* () {
          const row = yield* getRow(home, id, doc);
          if (!row.replies.some((r) => r.id === rId)) return yield* Effect.fail(replyNotFound(rId, id));
          const replies = row.replies.map((r) => (r.id === rId ? { ...r, body, editedAt: now() } : r));
          const saved = yield* save(home, { ...row, replies });
          yield* mark(saved);
          return toComment(saved);
        }),
      deleteReply: (home, id, rId, doc) =>
        Effect.gen(function* () {
          const row = yield* getRow(home, id, doc);
          if (!row.replies.some((r) => r.id === rId)) return yield* Effect.fail(replyNotFound(rId, id));
          const saved = yield* save(home, { ...row, replies: row.replies.filter((r) => r.id !== rId) });
          yield* mark(saved);
          return toComment(saved);
        }),
      setStatus: (home, id, doc, status, by) =>
        repo.setStatus(home, id, status, by).pipe(Effect.flatMap((r) => (r ? mark(r).pipe(Effect.as(toComment(r))) : Effect.fail(notFound(id, doc))))),
      review: (home, sessionId, doc, input) =>
        Effect.gen(function* () {
          if (!Number.isInteger(input.round) || input.round < 1) {
            return yield* Effect.fail(new IoFailure({ message: "round must be a whole number from 1", status: 500 }));
          }
          const rows = yield* repo.list(home, sessionId);
          const revs = yield* repo.listReviews(home, sessionId);
          const last = revs.filter((r) => r.doc === doc).reduce((m, r) => Math.max(m, Date.parse(r.createdAt)), 0);
          const pending = rows.filter((r) => r.doc === doc && r.status === "open" && Date.parse(r.createdAt) > last && !r.replies.some((x) => x.author === "agent"));
          if (pending.length > 0) {
            return yield* Effect.fail(new IoFailure({ message: `no reply from agent on ${pending.length} open comment(s), e.g. ${pending[0].id}`, status: 500 }));
          }
          const review: ReviewRow = { id: reviewId(), documentId: sessionId, doc, round: input.round, body: input.body, author: input.author, createdAt: now(), verdict: "commented" };
          yield* mark({ documentId: sessionId });
          return toReview(yield* repo.addReview(home, review));
        }),
    });
  }),
);

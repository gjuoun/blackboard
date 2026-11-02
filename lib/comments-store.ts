import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Context, Effect, Layer, Semaphore } from "effect";
import type { QuoteSelector } from "./anchor";
import { errorMessage, IoFailure, type LockTimeout } from "./effect/errors";
import { Lock } from "./lock";

/**
 * On-disk format of a comment file. Plain JSON on purpose: an agent reads it straight from
 * disk. Keys of `docs` name the doc the comments belong to.
 */
export type Reply = { id: string; body: string; author: string; createdAt: string; editedAt?: string };
type CommentStatus = "open" | "resolved";
export type Comment = {
  id: string;
  /** Exactly one anchor kind: a passage in the doc (`quote`), or none (`general`). */
  quote?: QuoteSelector;
  /** An independent comment: no passage. Listed at the bottom of the Comments pane. */
  general?: true;
  body: string;
  /** Stored comment image ids (`<sha256>.<ext>`), shown as thumbnails under the body. */
  images?: string[];
  author: string;
  createdAt: string;
  editedAt?: string;
  status: CommentStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  replies: Reply[];
};
/** One round's review: the agent has answered each open comment and closes the round. The verdict has one value. */
export type Review = { id: string; doc: string; round: number; body: string; author: string; createdAt: string; verdict: "commented" };
export type CommentFile = { version: 1; docs: Record<string, Comment[]>; reviews?: Review[] };

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/** The comments in a comment file; empty when the file does not exist. A file that does not parse is an error, never silently replaced. */
export function readComments(p: string): CommentFile {
  if (!existsSync(p)) return { version: 1, docs: {} };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || typeof data.docs !== "object") throw new Error(`unsupported comment file: ${p}`);
  return data as CommentFile;
}

function writeAtomic(p: string, data: CommentFile) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, p);
}

const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** The comment file store: the IO edges of a comment file, as an Effect service. */
export class CommentsStore extends Context.Service<
  CommentsStore,
  {
    read(file: string): Effect.Effect<CommentFile, IoFailure>;
    mutate<A>(file: string, change: (file: CommentFile) => A): Effect.Effect<A, IoFailure | LockTimeout>;
  }
>()("blackboard/CommentsStore") {}

/**
 * Read, change and write a comment file. Calls in this process take turns on a semaphore, and every
 * process (web app, CLI) holds the file lock for the read-change-write, so no writer loses another
 * writer's change. The write goes to a temp file renamed over the old one.
 */
export const layer = Layer.effect(
  CommentsStore,
  Effect.gen(function* () {
    const lock = yield* Lock;
    const gates = new Map<string, Semaphore.Semaphore>();
    const gateOf = (file: string): Effect.Effect<Semaphore.Semaphore> =>
      Effect.suspend(() => {
        const held = gates.get(file);
        if (held) return Effect.succeed(held);
        return Semaphore.make(1).pipe(Effect.tap((made) => Effect.sync(() => gates.set(file, made))));
      });
    const read = (file: string) => Effect.try({ try: () => readComments(file), catch: failure });
    const mutate = <A>(file: string, change: (current: CommentFile) => A): Effect.Effect<A, IoFailure | LockTimeout> =>
      Effect.gen(function* () {
        const gate = yield* gateOf(file);
        // The lock file lives in the same folder, so the folder must exist before it is taken.
        yield* Effect.sync(() => mkdirSync(dirname(file), { recursive: true }));
        return yield* gate.withPermits(1)(
          lock.withLock(
            file,
            Effect.gen(function* () {
              const current = yield* read(file);
              const result = yield* Effect.try({ try: () => change(current), catch: failure });
              yield* Effect.try({ try: () => writeAtomic(file, current), catch: failure });
              return result;
            }),
          ),
        );
      });
    return CommentsStore.of({ read, mutate });
  }),
);

function find(file: CommentFile, doc: string, id: string): Comment {
  const c = file.docs[doc]?.find((x) => x.id === id);
  if (!c) throw new Error(`comment ${id} not found in ${doc}`);
  return c;
}

/**
 * Closes a round for one doc. Refused while any open comment on the doc has no reply from `agent`; a comment
 * answered in an earlier round is settled, so only comments created after the last review count.
 */
export function reviewRound(file: CommentFile, doc: string, input: { round: number; body: string; author: string }): Review {
  if (!Number.isInteger(input.round) || input.round < 1) throw new Error("round must be a whole number from 1");
  const last = (file.reviews ?? []).filter((r) => r.doc === doc).reduce((m, r) => Math.max(m, Date.parse(r.createdAt)), 0);
  const pending = (file.docs[doc] ?? []).filter((c) => c.status === "open" && Date.parse(c.createdAt) > last && !c.replies.some((r) => r.author === "agent"));
  if (pending.length > 0) throw new Error(`no reply from agent on ${pending.length} open comment(s), e.g. ${pending[0].id}`);
  const review: Review = { id: newId("v"), doc, round: input.round, body: input.body, author: input.author, createdAt: now(), verdict: "commented" };
  (file.reviews ??= []).push(review);
  return review;
}

type CommentAnchor = { quote: QuoteSelector; general?: undefined } | { general: true; quote?: undefined };

/** A new comment on exactly one anchor kind: a passage of the doc, or nothing. */
export function addComment(file: CommentFile, doc: string, input: CommentAnchor & { body: string; author: string; images?: string[] }): Comment {
  const kinds = [input.quote ? 1 : 0, input.general ? 1 : 0].reduce((a, b) => a + b, 0);
  if (kinds !== 1) throw new Error("exactly one anchor (quote or general) is required");
  const anchor = input.quote ? { quote: input.quote } : { general: true as const };
  const c: Comment = { id: newId("c"), ...anchor, body: input.body, ...(input.images?.length ? { images: input.images } : {}), author: input.author, createdAt: now(), status: "open", replies: [] };
  (file.docs[doc] ??= []).push(c);
  return c;
}

/** Appends to the comment's flat thread. `joinReplyId`, when given, must be a reply already on that comment. */
export function addReply(file: CommentFile, doc: string, id: string, input: { body: string; author: string; joinReplyId?: string }): Comment {
  const c = find(file, doc, id);
  if (input.joinReplyId !== undefined) findReply(c, input.joinReplyId);
  c.replies.push({ id: newId("r"), body: input.body, author: input.author, createdAt: now() });
  return c;
}

export function editComment(file: CommentFile, doc: string, id: string, body: string): Comment {
  const c = find(file, doc, id);
  c.body = body;
  c.editedAt = now();
  return c;
}

/** Removes the comment and its replies. Returns the removed comment. */
export function deleteComment(file: CommentFile, doc: string, id: string): Comment {
  const c = find(file, doc, id);
  file.docs[doc] = file.docs[doc].filter((x) => x.id !== id);
  if (file.docs[doc].length === 0) delete file.docs[doc];
  return c;
}

function findReply(c: Comment, replyId: string): Reply {
  const r = c.replies.find((x) => x.id === replyId);
  if (!r) throw new Error(`reply ${replyId} not found on ${c.id}`);
  return r;
}

export function editReply(file: CommentFile, doc: string, id: string, replyId: string, body: string): Comment {
  const c = find(file, doc, id);
  const r = findReply(c, replyId);
  r.body = body;
  r.editedAt = now();
  return c;
}

export function deleteReply(file: CommentFile, doc: string, id: string, replyId: string): Comment {
  const c = find(file, doc, id);
  findReply(c, replyId);
  c.replies = c.replies.filter((r) => r.id !== replyId);
  return c;
}

export function setStatus(file: CommentFile, doc: string, id: string, status: CommentStatus, by: string): Comment {
  const c = find(file, doc, id);
  c.status = status;
  if (status === "resolved") {
    c.resolvedAt = now();
    c.resolvedBy = by;
  } else {
    if (c.resolvedAt) {
      c.reopenedAt = now();
      c.reopenedBy = by;
    }
    delete c.resolvedAt;
    delete c.resolvedBy;
  }
  return c;
}

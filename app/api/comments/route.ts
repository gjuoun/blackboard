import { basename } from "node:path";
import { Effect } from "effect";
import type { NextRequest } from "next/server";
import type { QuoteSelector } from "@/lib/anchor";
import { normalizeCodeAnchor, type CodeAnchor } from "@/lib/code-anchor";
import { IMAGE_ID } from "@/lib/comment-images";
import { renderComments, type RenderedComment } from "@/lib/comment-markdown";
import { addComment, addReply, deleteComment, deleteReply, editComment, editReply, mutate, readComments, setStatus, type Comment } from "@/lib/comments-store";
import { bodyRequired, CommentNotFound, errorMessage, InvalidInput, IoFailure, ReplyNotFound, sessionNotFound, type ApiFailure } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";
import { getSession, servablePath, sessionCommentsPath } from "@/lib/sessions";

const MAX_BODY = 10_000;

/** One comment as the client shows it: its bodies rendered to HTML. */
const one = (c: Comment): RenderedComment => renderComments([c])[0];

/** The comment file and doc key for a request, but only for a registered session whose file can still be served. */
function target(session: unknown): { file: string; doc: string } | null {
  if (typeof session !== "string") return null;
  const home = getHome();
  const s = getSession(home, session);
  if (!s || !servablePath(s)) return null;
  return { file: sessionCommentsPath(home, s.id), doc: basename(s.path) };
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);
const author = (v: unknown) => text(v, 64)?.trim() ?? "jun";

function quote(v: unknown): QuoteSelector | null {
  if (!v || typeof v !== "object") return null;
  const q = v as Record<string, unknown>;
  if (!text(q.exact, MAX_BODY) || typeof q.prefix !== "string" || typeof q.suffix !== "string") return null;
  return { exact: q.exact as string, prefix: q.prefix.slice(-64), suffix: q.suffix.slice(0, 64) };
}

const code = (v: unknown): CodeAnchor | null => (v === undefined ? null : normalizeCodeAnchor(v));

/** The request body as an object; a body that is not JSON is null, exactly as the old catch returned. */
const bodyOf = (req: NextRequest): Effect.Effect<Record<string, unknown> | null> =>
  Effect.tryPromise(() => req.json()).pipe(
    Effect.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null)),
    Effect.catch(() => Effect.succeed(null)),
  );

/** The body plus the session it names, or the 400 both are answered with today. */
function bodyTarget(req: NextRequest): Effect.Effect<{ payload: Record<string, unknown>; file: string; doc: string }, ApiFailure> {
  return Effect.gen(function* () {
    const payload = yield* bodyOf(req);
    const t = payload && target(payload.session);
    if (!payload || !t) return yield* Effect.fail(sessionNotFound(400));
    return { payload, ...t };
  });
}

/** The store's own two not-found messages become the two tags; anything else is an IO failure. */
const notFound = (message: string): ApiFailure =>
  message.startsWith("reply ") ? new ReplyNotFound({ message, status: 404 }) : new CommentNotFound({ message, status: 404 });

/** A store call as an Effect. `notFound` is absent for reads, whose errors are never a missing id. */
function call<T>(thunk: () => Promise<T> | T, notFound?: (message: string) => ApiFailure): Effect.Effect<T, ApiFailure> {
  return Effect.tryPromise({
    try: async () => thunk(),
    catch: (error) => {
      const message = errorMessage(error);
      if (notFound && /not found/.test(message)) return notFound(message);
      return new IoFailure({ message, status: 500 });
    },
  });
}

/** GET ?session= — the doc's comments, open and resolved. */
export async function GET(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const t = target(req.nextUrl.searchParams.get("session"));
      if (!t) return yield* Effect.fail(sessionNotFound(400));
      const found = yield* call(() => readComments(t.file).docs[t.doc] ?? []);
      return { comments: renderComments(found) };
    }),
  );
}

/** POST {session, quote | code, body, author} — a new comment on a passage or on a diff line. */
export async function POST(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const { payload: b, file, doc } = yield* bodyTarget(req);
      const q = quote(b.quote);
      const anchor = code(b.code);
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      const general = b.general === true;
      const kinds = Number(Boolean(q)) + Number(Boolean(anchor)) + Number(general);
      if (kinds !== 1) return yield* Effect.fail(new InvalidInput({ message: "exactly one of quote, code or general is required", status: 400, field: "quote" }));
      // Images are stored ids: each must be a valid stored name, so a client cannot point a comment at any file.
      const images = b.images === undefined ? [] : Array.isArray(b.images) && b.images.every((x) => typeof x === "string" && IMAGE_ID.test(x)) ? (b.images as string[]) : null;
      if (images === null || images.length > 4) return yield* Effect.fail(new InvalidInput({ message: "images must be up to 4 stored image ids", status: 400, field: "images" }));
      const kind = q ? { quote: q } : anchor ? { code: anchor } : { general: true as const };
      const comment = yield* call(() => mutate(file, (f) => addComment(f, doc, { ...kind, body, author: author(b.author), images })), notFound);
      return { comment: one(comment) };
    }),
    201,
  );
}

/**
 * PATCH {session, id, action, body?, replyId?, author?}
 * action: reply | resolve | reopen | edit | delete | edit-reply | delete-reply.
 * `id` is always a comment id. reply takes an optional replyId, which must be a reply on that comment;
 * the new reply joins that comment's flat thread.
 * delete answers {deleted: id}; every other action answers the updated {comment}, bodies rendered.
 */
export async function PATCH(req: NextRequest) {
  return respond(patchProgram(req));
}

function patchProgram(req: NextRequest): Effect.Effect<Record<string, unknown>, ApiFailure> {
  return Effect.gen(function* () {
    const { payload: b, file, doc } = yield* bodyTarget(req);
    const id = text(b.id, 64);
    if (!id) return yield* Effect.fail(new InvalidInput({ message: "id is required", status: 400, field: "id" }));
    const who = author(b.author);

    if (b.action === "reply") {
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      const joinReplyId = b.replyId === undefined ? undefined : (text(b.replyId, 64) ?? undefined);
      if (b.replyId !== undefined && !joinReplyId) return yield* Effect.fail(new InvalidInput({ message: "replyId must be a reply id", status: 400, field: "replyId" }));
      return { comment: one(yield* call(() => mutate(file, (f) => addReply(f, doc, id, { body, author: who, joinReplyId })), notFound)) };
    }

    if (b.action === "edit") {
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      return { comment: one(yield* call(() => mutate(file, (f) => editComment(f, doc, id, body)), notFound)) };
    }

    if (b.action === "delete") {
      yield* call(() => mutate(file, (f) => deleteComment(f, doc, id)), notFound);
      return { deleted: id };
    }

    if (b.action === "edit-reply" || b.action === "delete-reply") {
      const replyId = text(b.replyId, 64);
      if (!replyId) return yield* Effect.fail(new InvalidInput({ message: "replyId is required", status: 400, field: "replyId" }));
      if (b.action === "delete-reply") {
        return { comment: one(yield* call(() => mutate(file, (f) => deleteReply(f, doc, id, replyId)), notFound)) };
      }
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      return { comment: one(yield* call(() => mutate(file, (f) => editReply(f, doc, id, replyId, body)), notFound)) };
    }

    if (b.action === "resolve" || b.action === "reopen") {
      const status = b.action === "resolve" ? "resolved" : "open";
      return { comment: one(yield* call(() => mutate(file, (f) => setStatus(f, doc, id, status, who)), notFound)) };
    }

    return yield* Effect.fail(new InvalidInput({ message: "unknown action", status: 400, field: "action" }));
  });
}

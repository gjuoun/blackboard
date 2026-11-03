import { basename } from "node:path";
import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { notifyAgent, payloadFor } from "@/lib/agent-notify";
import { AgentsStore } from "@/lib/agents-store";
import type { QuoteSelector } from "@/lib/anchor";
import { IMAGE_ID } from "@/lib/comment-images";
import { renderComments, type RenderedComment } from "@/lib/comment-markdown";
import {
  addComment,
  addReply,
  CommentsStore,
  deleteComment,
  deleteReply,
  editComment,
  editReply,
  setStatus,
  type Comment,
} from "@/lib/comments-store";
import { bodyRequired, CommentNotFound, InvalidInput, IoFailure, ReplyNotFound, sessionNotFound, type ApiFailure, type LockTimeout } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { CommentPatchBody, CommentPostBody, decodeBody, jsonBody, patchReject, postReject } from "@/lib/effect/schema";
import { getHome } from "@/lib/home";
import { servablePath, sessionCommentsPath, SessionsStore, type Session } from "@/lib/sessions";

const MAX_BODY = 10_000;

/** One comment as the client shows it: its bodies rendered to HTML. */
const one = (c: Comment): RenderedComment => renderComments([c])[0];

/** Where a comment for these requests lives: the doc, its comment file, and the session it names. */
type Target = { home: string; session: Session; file: string; doc: string };

/** The comment file and doc key for a request, but only for a registered session whose file can still be served. */
function target(session: string): Effect.Effect<Target | null, IoFailure, SessionsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const home = getHome();
    const found = yield* sessions.get(home, session);
    if (!found || !servablePath(found)) return null;
    return { home, session: found, file: sessionCommentsPath(home, found.id), doc: basename(found.path) };
  });
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);
const author = (v: unknown) => text(v, 64)?.trim() ?? "jun";

function quote(v: unknown): QuoteSelector | null {
  if (!v || typeof v !== "object") return null;
  const q = v as Record<string, unknown>;
  if (!text(q.exact, MAX_BODY) || typeof q.prefix !== "string" || typeof q.suffix !== "string") return null;
  return { exact: q.exact as string, prefix: q.prefix.slice(-64), suffix: q.suffix.slice(0, 64) };
}

/** The action a raw PATCH body names, used to pick the replyId message when the schema rejects it. */
const actionOf = (raw: unknown): unknown => (raw && typeof raw === "object" ? (raw as Record<string, unknown>).action : undefined);

/** A raw POST body, decoded by its schema, plus the session it names. */
function postTarget(req: NextRequest): Effect.Effect<{ body: typeof CommentPostBody.Type } & Target, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const raw = yield* jsonBody(req);
    if (raw === null) return yield* Effect.fail(sessionNotFound(400));
    const body = yield* decodeBody(CommentPostBody, raw, postReject);
    const found = yield* target(body.session);
    if (!found) return yield* Effect.fail(sessionNotFound(400));
    return { body, ...found };
  });
}

/** The same for a PATCH: the action union is decoded by the schema, and it chooses the replyId message. */
function patchTarget(req: NextRequest): Effect.Effect<{ body: typeof CommentPatchBody.Type } & Target, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const raw = yield* jsonBody(req);
    if (raw === null) return yield* Effect.fail(sessionNotFound(400));
    const body = yield* decodeBody(CommentPatchBody, raw, patchReject(actionOf(raw)));
    const found = yield* target(body.session);
    if (!found) return yield* Effect.fail(sessionNotFound(400));
    return { body, ...found };
  });
}

/** The store own two not-found messages become the two tags; anything else is an IO failure. */
const notFound = (message: string): ApiFailure =>
  message.startsWith("reply ") ? new ReplyNotFound({ message, status: 404 }) : new CommentNotFound({ message, status: 404 });

/** A store call with the messages the route already answered: a missing id is a 404, the rest is 500. */
function storeCall<A>(effect: Effect.Effect<A, IoFailure | LockTimeout>): Effect.Effect<A, ApiFailure> {
  return effect.pipe(
    Effect.mapError((error): ApiFailure => (/not found/.test(error.message) ? notFound(error.message) : error)),
  );
}

/**
 * Tell the pi session bound to this doc that a comment or reply just arrived. The write already
 * landed: the lookup ignores a missing or unreadable agents file, and the POST itself is not
 * awaited, so a session that is gone cannot fail or slow down the submitter.
 */
function ping(req: NextRequest, at: Pick<Target, "home" | "session" | "doc">, comment: Comment, body: string, author: string) {
  return Effect.gen(function* () {
    const agents = yield* AgentsStore;
    const binding = yield* agents.get(at.home, at.session.id).pipe(Effect.catch(() => Effect.succeed(null)));
    const pageUrl = new URL(req.url).origin + `/s/${at.session.id}`;
    notifyAgent(binding, payloadFor({ session: at.session.id, doc: at.doc, comment, body, author, pageUrl }));
  });
}

/** GET ?session= — the doc comments, open and resolved. */
export async function GET(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const comments = yield* CommentsStore;
      const found = yield* target(req.nextUrl.searchParams.get("session") ?? "");
      if (!found) return yield* Effect.fail(sessionNotFound(400));
      const file = yield* comments.read(found.file);
      return { comments: renderComments(file.docs[found.doc] ?? []) };
    }),
  );
}

/** POST {session, quote | general, body, author} — a new comment on a passage or on nothing. */
export async function POST(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const comments = yield* CommentsStore;
      const { body: b, file, doc, home, session } = yield* postTarget(req);
      const q = quote(b.quote);
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      const general = b.general === true;
      const kinds = Number(Boolean(q)) + Number(general);
      if (kinds !== 1) return yield* Effect.fail(new InvalidInput({ message: "exactly one of quote or general is required", status: 400, field: "quote" }));
      // Images are stored ids: each must be a valid stored name, so a client cannot point a comment at any file.
      const images = b.images === undefined ? [] : b.images.every((x) => IMAGE_ID.test(x)) ? [...b.images] : null;
      if (images === null || images.length > 4) return yield* Effect.fail(new InvalidInput({ message: "images must be up to 4 stored image ids", status: 400, field: "images" }));
      const kind = q ? { quote: q } : { general: true as const };
      const who = author(b.author);
      const comment = yield* storeCall(comments.mutate(file, (f) => addComment(f, doc, { ...kind, body, author: who, images })));
      yield* ping(req, { home, session, doc }, comment, body, who);
      return { comment: one(comment) };
    }),
    201,
  );
}

/**
 * PATCH {session, id, action, body?, replyId?, author?}
 * action: reply | resolve | reopen | edit | delete | edit-reply | delete-reply.
 * id is always a comment id. reply takes an optional replyId, which must be a reply on that comment;
 * the new reply joins that comment flat thread.
 * delete answers {deleted: id}; every other action answers the updated {comment}, bodies rendered.
 */
export async function PATCH(req: NextRequest) {
  return respond(patchProgram(req));
}

function patchProgram(req: NextRequest): Effect.Effect<Record<string, unknown>, ApiFailure, CommentsStore | SessionsStore | AgentsStore> {
  return Effect.gen(function* () {
    const comments = yield* CommentsStore;
    const { body: b, file, doc, home, session } = yield* patchTarget(req);
    const id = text(b.id, 64);
    if (!id) return yield* Effect.fail(new InvalidInput({ message: "id is required", status: 400, field: "id" }));
    const who = author(b.author);

    if (b.action === "reply") {
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      const joinReplyId = b.replyId === undefined ? undefined : (text(b.replyId, 64) ?? undefined);
      if (b.replyId !== undefined && !joinReplyId) return yield* Effect.fail(new InvalidInput({ message: "replyId must be a reply id", status: 400, field: "replyId" }));
      const comment = yield* storeCall(comments.mutate(file, (f) => addReply(f, doc, id, { body, author: who, joinReplyId })));
      yield* ping(req, { home, session, doc }, comment, body, who);
      return { comment: one(comment) };
    }

    if (b.action === "edit") {
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      return { comment: one(yield* storeCall(comments.mutate(file, (f) => editComment(f, doc, id, body)))) };
    }

    if (b.action === "delete") {
      yield* storeCall(comments.mutate(file, (f) => deleteComment(f, doc, id)));
      return { deleted: id };
    }

    if (b.action === "edit-reply" || b.action === "delete-reply") {
      const replyId = text(b.replyId, 64);
      if (!replyId) return yield* Effect.fail(new InvalidInput({ message: "replyId is required", status: 400, field: "replyId" }));
      if (b.action === "delete-reply") {
        return { comment: one(yield* storeCall(comments.mutate(file, (f) => deleteReply(f, doc, id, replyId)))) };
      }
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      return { comment: one(yield* storeCall(comments.mutate(file, (f) => editReply(f, doc, id, replyId, body)))) };
    }

    if (b.action === "resolve" || b.action === "reopen") {
      const status = b.action === "resolve" ? "resolved" : "open";
      return { comment: one(yield* storeCall(comments.mutate(file, (f) => setStatus(f, doc, id, status, who)))) };
    }

    return yield* Effect.fail(new InvalidInput({ message: "unknown action", status: 400, field: "action" }));
  });
}
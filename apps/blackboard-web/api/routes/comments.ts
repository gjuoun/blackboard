import { Effect } from "effect";
import { Hono } from "hono";
import { notifyAgent, payloadFor } from "../../lib/agent-notify";
import { AgentsStore } from "../../lib/agents-store";
import type { QuoteSelector } from "../../lib/anchor";
import { IMAGE_ID } from "../../lib/comment-images";
import { type RenderedComment, renderComments } from "../../lib/comment-markdown";
import { type Comment, CommentsStore } from "../../lib/comments-store";
import {
  type ApiFailure,
  bodyRequired,
  CommentNotFound,
  InvalidInput,
  ReplyNotFound,
  sessionNotFound,
} from "../../lib/effect/errors";
import {
  CommentPatchBody,
  CommentPostBody,
  decodeBody,
  jsonBody,
  patchReject,
  postReject,
} from "../../lib/effect/schema";
import { getHome } from "../../lib/home";
import { docKey } from "../../lib/session-model";
import { type Session, SessionsStore, servablePath } from "../../lib/sessions";
import { respond } from "../respond";

const MAX_BODY = 10_000;

/** One comment as the client shows it: its bodies rendered to HTML. */
const one = (c: Comment): RenderedComment => renderComments([c])[0];

/** The doc key and session for a request, but only for a registered session whose file can still be served. */
type Target = { home: string; session: Session; doc: string };

function target(session: string): Effect.Effect<Target | null, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const home = getHome();
    const found = yield* sessions.get(home, session);
    if (!found || !servablePath(found)) return null;
    return { home, session: found, doc: docKey(found) };
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
const actionOf = (raw: unknown): unknown =>
  raw && typeof raw === "object" ? (raw as Record<string, unknown>).action : undefined;

function postTarget(
  req: Request,
): Effect.Effect<{ body: typeof CommentPostBody.Type } & Target, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const raw = yield* jsonBody(req);
    if (raw === null) return yield* Effect.fail(sessionNotFound(400));
    const body = yield* decodeBody(CommentPostBody, raw, postReject);
    const found = yield* target(body.session);
    if (!found) return yield* Effect.fail(sessionNotFound(400));
    return { body, ...found };
  });
}

function patchTarget(
  req: Request,
): Effect.Effect<{ body: typeof CommentPatchBody.Type } & Target, ApiFailure, SessionsStore> {
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
  message.startsWith("reply ")
    ? new ReplyNotFound({ message, status: 404 })
    : new CommentNotFound({ message, status: 404 });

/** A store call with the messages the route already answered: a missing id is a 404, the rest is 500. */
function storeCall<A>(effect: Effect.Effect<A, ApiFailure>): Effect.Effect<A, ApiFailure> {
  return effect.pipe(
    Effect.mapError(
      (error): ApiFailure => (/not found/.test(error.message) ? notFound(error.message) : error),
    ),
  );
}

/**
 * The page URL a notify payload links to: the UI origin the browser used, forwarded by the Next
 * forwarder as x-forwarded-host. A direct API call falls back to the API origin itself.
 */
function pageOrigin(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-host");
  const host = forwarded ?? new URL(req.url).host;
  return `http://${host}`;
}

/** Tell the pi session bound to this doc that a comment was just submitted; fire-and-forget. */
function ping(
  req: Request,
  at: Pick<Target, "home" | "session" | "doc">,
  comment: Comment,
  body: string,
  author: string,
) {
  return Effect.gen(function* () {
    const agents = yield* AgentsStore;
    const binding = yield* agents.get(at.home, at.session.id).pipe(Effect.catch(() => Effect.succeed(null)));
    const pageUrl = pageOrigin(req) + `/s/${at.session.id}`;
    notifyAgent(binding, payloadFor({ session: at.session.id, doc: at.doc, comment, body, author, pageUrl }));
  });
}

export const comments = new Hono();

/** GET ?session= — the doc comments, open and resolved. */
comments.get("/", (c) =>
  respond(
    Effect.gen(function* () {
      const store = yield* CommentsStore;
      const found = yield* target(new URL(c.req.url).searchParams.get("session") ?? "");
      if (!found) return yield* Effect.fail(sessionNotFound(400));
      const file = yield* store.read(found.home, found.session.id);
      return { comments: renderComments(file.docs[found.doc] ?? []) };
    }),
  ),
);

/** POST {session, quote | general, body, author} — a new comment on a passage or on nothing. */
comments.post("/", (c) =>
  respond(
    Effect.gen(function* () {
      const store = yield* CommentsStore;
      const { body: b, doc, home, session } = yield* postTarget(c.req.raw);
      const q = quote(b.quote);
      const body = text(b.body, MAX_BODY);
      if (!body) return yield* Effect.fail(bodyRequired());
      const general = b.general === true;
      const kinds = Number(Boolean(q)) + Number(general);
      if (kinds !== 1)
        return yield* Effect.fail(
          new InvalidInput({
            message: "exactly one of quote or general is required",
            status: 400,
            field: "quote",
          }),
        );
      const images =
        b.images === undefined ? [] : b.images.every((x) => IMAGE_ID.test(x)) ? [...b.images] : null;
      if (images === null || images.length > 4)
        return yield* Effect.fail(
          new InvalidInput({
            message: "images must be up to 4 stored image ids",
            status: 400,
            field: "images",
          }),
        );
      const kind = q ? { quote: q } : { general: true as const };
      const who = author(b.author);
      const comment = yield* storeCall(
        store.add(home, session.id, doc, { ...kind, body, author: who, images }),
      );
      yield* ping(c.req.raw, { home, session, doc }, comment, body, who);
      return { comment: one(comment) };
    }),
    201,
  ),
);

/** PATCH {session, id, action, body?, replyId?, author?} — the seven comment actions. */
comments.patch("/", (c) =>
  respond(
    Effect.gen(function* () {
      const store = yield* CommentsStore;
      const { body: b, home, doc } = yield* patchTarget(c.req.raw);
      const id = text(b.id, 64);
      if (!id)
        return yield* Effect.fail(new InvalidInput({ message: "id is required", status: 400, field: "id" }));
      const who = author(b.author);

      if (b.action === "reply") {
        const body = text(b.body, MAX_BODY);
        if (!body) return yield* Effect.fail(bodyRequired());
        const joinReplyId = b.replyId === undefined ? undefined : (text(b.replyId, 64) ?? undefined);
        if (b.replyId !== undefined && !joinReplyId)
          return yield* Effect.fail(
            new InvalidInput({ message: "replyId must be a reply id", status: 400, field: "replyId" }),
          );
        return {
          comment: one(yield* storeCall(store.reply(home, id, doc, { body, author: who, joinReplyId }))),
        };
      }
      if (b.action === "edit") {
        const body = text(b.body, MAX_BODY);
        if (!body) return yield* Effect.fail(bodyRequired());
        return { comment: one(yield* storeCall(store.edit(home, id, doc, body))) };
      }
      if (b.action === "delete") {
        yield* storeCall(store.remove(home, id, doc));
        return { deleted: id };
      }
      if (b.action === "edit-reply" || b.action === "delete-reply") {
        const replyId = text(b.replyId, 64);
        if (!replyId)
          return yield* Effect.fail(
            new InvalidInput({ message: "replyId is required", status: 400, field: "replyId" }),
          );
        if (b.action === "delete-reply") {
          return { comment: one(yield* storeCall(store.deleteReply(home, id, replyId, doc))) };
        }
        const body = text(b.body, MAX_BODY);
        if (!body) return yield* Effect.fail(bodyRequired());
        return { comment: one(yield* storeCall(store.editReply(home, id, replyId, doc, body))) };
      }
      if (b.action === "resolve" || b.action === "reopen") {
        const status = b.action === "resolve" ? "resolved" : "open";
        return { comment: one(yield* storeCall(store.setStatus(home, id, doc, status, who))) };
      }
      return yield* Effect.fail(
        new InvalidInput({ message: "unknown action", status: 400, field: "action" }),
      );
    }),
  ),
);

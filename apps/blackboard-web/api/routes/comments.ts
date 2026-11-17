import { Pipe, Runtime, Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { notifyAgent, payloadFor } from "../../lib/agent-notify";
import type { QuoteSelector } from "../../lib/anchor";
import {
  CommentPatchBody,
  CommentPostBody,
  decodeBody,
  jsonBody,
  patchReject,
  postReject,
} from "../../lib/body-schema";
import { IMAGE_ID } from "../../lib/comment-images";
import { type RenderedComment, renderComments } from "../../lib/comment-markdown";
import type { Comment, CommentsStore } from "../../lib/comments-store";
import type { AgentsRepo } from "../../lib/db/repos/agents";
import {
  type ApiFailure,
  bodyRequired,
  CommentNotFound,
  failures,
  InvalidInput,
  ReplyNotFound,
  sessionNotFound,
} from "../../lib/errors";
import { getHome } from "../../lib/home";
import { docKey } from "../../lib/session-model";
import { type Session, type SessionsStore, servablePath } from "../../lib/sessions";
import { run, services } from "../../test/app";
import { json } from "../platform/http/envelope";

const MAX_BODY = 10_000;

/** One comment as the client shows it: its bodies rendered to HTML. */
const one = (c: Comment): RenderedComment => renderComments([c])[0];

/** The doc key and session for a request, but only for a registered session whose file can still be served. */
type Target = { home: string; session: Session; doc: string };

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

function target(sessions: SessionsStore, session: string): Safe<Target | null, ApiFailure> {
  return Safe.try(function* () {
    const home = getHome();
    const found = (yield sessions.get(home, session)) as Session | null;
    if (!found || !servablePath(found)) return null;
    return { home, session: found, doc: docKey(found) };
  }) as unknown as Safe<Target | null, ApiFailure>;
}

function postTarget(
  sessions: SessionsStore,
  req: Request,
): Safe<{ body: Record<string, unknown> } & Target, ApiFailure> {
  return Safe.try(function* () {
    const raw = (yield jsonBody(req)) as unknown | null;
    if (raw === null) return (yield Safe.err(sessionNotFound(400))) as never;
    const body = (yield decodeBody(CommentPostBody, raw, postReject)) as unknown as Record<string, unknown>;
    const found = (yield target(sessions, body.session as string)) as Target | null;
    if (!found) return (yield Safe.err(sessionNotFound(400))) as never;
    return { body, ...found };
  }) as unknown as Safe<{ body: Record<string, unknown> } & Target, ApiFailure>;
}

function patchTarget(
  sessions: SessionsStore,
  req: Request,
): Safe<{ body: Record<string, unknown> } & Target, ApiFailure> {
  return Safe.try(function* () {
    const raw = (yield jsonBody(req)) as unknown | null;
    if (raw === null) return (yield Safe.err(sessionNotFound(400))) as never;
    const body = (yield decodeBody(CommentPatchBody, raw, patchReject(actionOf(raw)))) as unknown as Record<
      string,
      unknown
    >;
    const found = (yield target(sessions, body.session as string)) as Target | null;
    if (!found) return (yield Safe.err(sessionNotFound(400))) as never;
    return { body, ...found };
  }) as unknown as Safe<{ body: Record<string, unknown> } & Target, ApiFailure>;
}

/** The store's own two not-found messages become the two tags; anything else is an IO failure. */
const notFound = (message: string): ApiFailure =>
  message.startsWith("reply ")
    ? failures.ReplyNotFound(message, 404)
    : failures.CommentNotFound(message, 404);

/** A store call with the messages the route already answered: a missing id is a 404, the rest is 500. */
const storeCall = <A>(safe: Safe<A, ApiFailure>): Safe<A, ApiFailure> =>
  Safe.try(function* () {
    return (yield safe) as A;
  }) as unknown as Safe<A, ApiFailure>;

/**
 * The page URL a notify payload links to: the UI origin the browser used, forwarded by the forwarder
 * as x-forwarded-host. A direct API call falls back to the API origin itself.
 */
function pageOrigin(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-host");
  const host = forwarded ?? new URL(req.url).host;
  return `http://${host}`;
}

export const commentsRoutes = (comments: CommentsStore, sessions: SessionsStore, agents: AgentsRepo) => {
  const app = new Hono();

  /** Tell the pi session bound to this doc that a comment was just submitted; fire-and-forget. */
  const ping = (req: Request, at: Target, comment: Comment, body: string, who: string): void => {
    const payload = payloadFor({
      session: at.session.id,
      doc: at.doc,
      comment,
      body,
      author: who,
      pageUrl: pageOrigin(req) + `/s/${at.session.id}`,
    });
    // Fire-and-forget: the comment is already stored, so a missing binding or a dead listener is not
    // this request's failure.
    void Runtime.run(
      Safe.pipe(
        agents.get(at.home, at.session.id),
        Pipe.catchTag("DbFailure", () => Safe.ok(null)),
      ) as unknown as Safe<unknown, never>,
    ).then((exit) => {
      notifyAgent(
        exit._tag === "success" ? (exit.value as Parameters<typeof notifyAgent>[0]) : null,
        payload,
      );
    });
  };

  /** GET ?session= — the doc comments, open and resolved. */
  app.get("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const found = (yield target(
          sessions,
          new URL(c.req.url).searchParams.get("session") ?? "",
        )) as Target | null;
        if (!found) return (yield Safe.err(sessionNotFound(400))) as never;
        const file = (yield comments.read(found.home, found.session.id)) as {
          docs: Record<string, Comment[]>;
        };
        return { comments: renderComments(file.docs[found.doc] ?? []) };
      }) as unknown as Safe<{ comments: RenderedComment[] }, ApiFailure>,
    ),
  );

  /** POST {session, quote | general, body, author} — a new comment on a passage or on nothing. */
  app.post("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const {
          body: b,
          doc,
          home,
          session,
        } = (yield postTarget(sessions, c.req.raw)) as {
          body: Record<string, unknown>;
        } & Target;
        const q = quote(b.quote);
        const body = text(b.body, MAX_BODY);
        if (!body) return (yield Safe.err(bodyRequired())) as never;
        const general = b.general === true;
        if (Number(Boolean(q)) + Number(general) !== 1)
          return (yield Safe.err(
            failures.InvalidInput("exactly one of quote or general is required", "quote", 400),
          )) as never;
        const images =
          b.images === undefined
            ? []
            : Array.isArray(b.images) && b.images.every((x) => typeof x === "string" && IMAGE_ID.test(x))
              ? [...(b.images as string[])]
              : null;
        if (images === null || images.length > 4)
          return (yield Safe.err(
            failures.InvalidInput("images must be up to 4 stored image ids", "images", 400),
          )) as never;
        const kind = q ? { quote: q } : { general: true as const };
        const who = author(b.author);
        const comment = (yield storeCall(
          comments.add(home, session.id, doc, { ...kind, body, author: who, images }),
        )) as Comment;
        ping(c.req.raw, { home, session, doc }, comment, body, who);
        return { comment: one(comment) };
      }) as unknown as Safe<{ comment: RenderedComment }, ApiFailure>,
      201,
    ),
  );

  /** PATCH {session, id, action, body?, replyId?, author?} — the seven comment actions. */
  app.patch("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const {
          body: b,
          home,
          doc,
        } = (yield patchTarget(sessions, c.req.raw)) as {
          body: Record<string, unknown>;
        } & Target;
        const id = text(b.id, 64);
        if (!id) return (yield Safe.err(failures.InvalidInput("id is required", "id", 400))) as never;
        const who = author(b.author);

        if (b.action === "reply") {
          const body = text(b.body, MAX_BODY);
          if (!body) return (yield Safe.err(bodyRequired())) as never;
          const joinReplyId = b.replyId === undefined ? undefined : (text(b.replyId, 64) ?? undefined);
          if (b.replyId !== undefined && !joinReplyId)
            return (yield Safe.err(
              failures.InvalidInput("replyId must be a reply id", "replyId", 400),
            )) as never;
          return {
            comment: one(
              (yield storeCall(comments.reply(home, id, doc, { body, author: who, joinReplyId }))) as Comment,
            ),
          };
        }
        if (b.action === "edit") {
          const body = text(b.body, MAX_BODY);
          if (!body) return (yield Safe.err(bodyRequired())) as never;
          return { comment: one((yield storeCall(comments.edit(home, id, doc, body))) as Comment) };
        }
        if (b.action === "delete") {
          yield storeCall(comments.remove(home, id, doc));
          return { deleted: id };
        }
        if (b.action === "edit-reply" || b.action === "delete-reply") {
          const replyId = text(b.replyId, 64);
          if (!replyId)
            return (yield Safe.err(failures.InvalidInput("replyId is required", "replyId", 400))) as never;
          if (b.action === "delete-reply")
            return {
              comment: one((yield storeCall(comments.deleteReply(home, id, replyId, doc))) as Comment),
            };
          const body = text(b.body, MAX_BODY);
          if (!body) return (yield Safe.err(bodyRequired())) as never;
          return {
            comment: one((yield storeCall(comments.editReply(home, id, replyId, doc, body))) as Comment),
          };
        }
        if (b.action === "resolve" || b.action === "reopen") {
          const status = b.action === "resolve" ? "resolved" : "open";
          return {
            comment: one((yield storeCall(comments.setStatus(home, id, doc, status, who))) as Comment),
          };
        }
        return (yield Safe.err(failures.InvalidInput("unknown action", "action", 400))) as never;
      }) as unknown as Safe<unknown, ApiFailure>,
    ),
  );

  return app;
};

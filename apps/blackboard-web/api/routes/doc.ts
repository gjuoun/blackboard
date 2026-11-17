import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { jsonBody } from "../../lib/body-schema";
import { renderComments } from "../../lib/comment-markdown";
import type { Comment, CommentsStore } from "../../lib/comments-store";
import { type ApiFailure, failures, InvalidInput, sessionNotFound } from "../../lib/errors";
import { getHome } from "../../lib/home";
import type { ReadingStateStore } from "../../lib/reading-state";
import { workspaceDocs } from "../../lib/reading-workspace";
import { docKey } from "../../lib/session-model";
import { realDoc, type Session, type SessionRow, type SessionsStore, toWire } from "../../lib/sessions";
import { json } from "../platform/http/envelope";

/**
 * The endpoints the UI pages read: session lists, one session's full data, the inbox workspace, and
 * the registration/close the CLI posts to. Rendering stays in the page — this route only answers the
 * data the page cannot compute itself.
 */
export const docRoutes = (sessions: SessionsStore, comments: CommentsStore, state: ReadingStateStore) => {
  const app = new Hono();

  /** GET /api/sessions — every registered session row. Reads only: the CLI lists through this. */
  app.get("/sessions", (c) =>
    json(
      c,
      Safe.try(function* () {
        const rows = (yield sessions.rows(getHome())) as SessionRow[];
        return { rows: rows.map(toWire) };
      }) as unknown as Safe<{ rows: unknown[] }, ApiFailure>,
    ),
  );

  /** GET /api/session?id= — one session with its row and whole comment surface for the doc page. */
  app.get("/session", (c) =>
    json(
      c,
      Safe.try(function* () {
        const home = getHome();
        const id = new URL(c.req.url).searchParams.get("id") ?? "";
        const session = (yield sessions.get(home, id)) as Session | null;
        if (!session) return (yield Safe.err(sessionNotFound(404))) as never;
        const row = (yield sessions.row(home, session)) as SessionRow;
        const file = (yield comments.read(home, session.id)) as { docs: Record<string, Comment[]> };
        const key = docKey(session);
        const body = (yield sessions.body(home, session.id)) as string | null;
        return { session, row: toWire(row), body, comments: renderComments(file.docs[key] ?? []) };
      }) as unknown as Safe<unknown, ApiFailure>,
    ),
  );

  /** GET /api/workspace — the inbox: every document with its reading state and counts. */
  app.get("/workspace", (c) => json(c, workspaceDocs(sessions, state, getHome())));

  /** GET /api/resolve?ref=&cwd= — id-or-path to a session, for the CLI. Null when it names nothing. */
  app.get("/resolve", (c) =>
    json(
      c,
      Safe.try(function* () {
        const url = new URL(c.req.url);
        const ref = url.searchParams.get("ref") ?? "";
        const cwd = url.searchParams.get("cwd") ?? process.cwd();
        const session = (yield sessions.resolve(getHome(), ref, cwd)) as Session | null;
        return { session };
      }) as unknown as Safe<{ session: Session | null }, ApiFailure>,
    ),
  );

  /** POST /api/open {path} — register a doc (idempotent) and answer its session + page URL. */
  app.post("/open", (c) =>
    json(
      c,
      Safe.try(function* () {
        const raw = (yield jsonBody(c.req.raw)) as Record<string, unknown> | null;
        const path = raw && typeof raw.path === "string" ? raw.path : null;
        if (!path) return (yield Safe.err(failures.InvalidInput("path is required", "path", 400))) as never;
        const real = (yield Safe.call(
          () => realDoc(path),
          (error) =>
            failures.InvalidInput(error instanceof Error ? error.message : String(error), undefined, 400),
        )) as string;
        const session = (yield sessions.open(getHome(), real)) as Session;
        return { session };
      }) as unknown as Safe<{ session: Session }, ApiFailure>,
      201,
    ),
  );

  /** POST /api/close {session} — forget a session; its comments stay. */
  app.post("/close", (c) =>
    json(
      c,
      Safe.try(function* () {
        const raw = (yield jsonBody(c.req.raw)) as Record<string, unknown> | null;
        const ref = raw && typeof raw.session === "string" ? raw.session : "";
        const session = (yield sessions.resolve(getHome(), ref)) as Session | null;
        if (!session) return (yield Safe.err(sessionNotFound(400))) as never;
        const closed = (yield sessions.close(getHome(), session.id)) as Session;
        return { session: closed };
      }) as unknown as Safe<{ session: Session }, ApiFailure>,
    ),
  );

  return app;
};

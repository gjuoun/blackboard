
import { Effect } from "effect";
import { Hono } from "hono";
import { renderComments } from "../../lib/comment-markdown";
import { CommentsStore } from "../../lib/comments-store";
import { InvalidInput, sessionNotFound } from "../../lib/effect/errors";
import { jsonBody } from "../../lib/effect/schema";
import { getHome } from "../../lib/home";
import { workspaceDocs } from "../../lib/reading-workspace";
import { docKey } from "../../lib/session-model";
import { realDoc, SCRATCHPAD_ID, SessionsStore, toWire } from "../../lib/sessions";
import { respond } from "../respond";

/**
 * The endpoints the UI pages read: session lists, one session's full data, the inbox workspace,
 * and the registration/close the CLI posts to. Rendering stays in the page — this route only
 * answers the data the page cannot compute itself.
 */
export const doc = new Hono();

/** GET /api/sessions — every registered session row. Reads only: the CLI lists through this. */
doc.get("/sessions", () =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      return { rows: (yield* sessions.rows(getHome())).map(toWire) };
    }),
  ),
);

/** GET /api/scratchpad — the scratchpad row, created on first use. The home page shows it pinned. */
doc.get("/scratchpad", () =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const home = getHome();
      const scratch = yield* sessions.scratchpad(home);
      return { pad: toWire(yield* sessions.row(home, scratch)) };
    }),
  ),
);

/** GET /api/session?id= — one session with its row and whole comment surface for the doc page. */
doc.get("/session", (c) =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const comments = yield* CommentsStore;
      const home = getHome();
      const id = new URL(c.req.url).searchParams.get("id") ?? "";
      if (id === SCRATCHPAD_ID) yield* sessions.scratchpad(home);
      const session = yield* sessions.get(home, id);
      if (!session) return yield* Effect.fail(sessionNotFound(404));
      const row = yield* sessions.row(home, session);
      const file = yield* comments.read(home, session.id);
      const key = docKey(session);
      const body = yield* sessions.body(home, session.id);
      return { session, row: toWire(row), body, comments: renderComments(file.docs[key] ?? []), reviews: (file.reviews ?? []).filter((r) => r.doc === key) };
    }),
  ),
);

/** GET /api/workspace — the inbox: every document with its reading state and counts. */
doc.get("/workspace", () => respond(workspaceDocs(getHome())));

/** GET /api/resolve?ref=&cwd= — id-or-path to a session, for the CLI. Null when it names nothing. */
doc.get("/resolve", (c) =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const url = new URL(c.req.url);
      const ref = url.searchParams.get("ref") ?? "";
      const cwd = url.searchParams.get("cwd") ?? process.cwd();
      const session = yield* sessions.resolve(getHome(), ref, cwd);
      return { session };
    }),
  ),
);

/** POST /api/open {path} — register a doc (idempotent) and answer its session + page URL. */
doc.post("/open", (c) =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const raw = yield* jsonBody(c.req.raw);
      const path = raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).path === "string" ? ((raw as Record<string, unknown>).path as string) : null;
      if (!path) return yield* Effect.fail(new InvalidInput({ message: "path is required", status: 400, field: "path" }));
      const real = yield* Effect.try({
        try: () => realDoc(path),
        catch: (error) => new InvalidInput({ message: error instanceof Error ? error.message : String(error), status: 400 }),
      });
      const session = yield* sessions.open(getHome(), real);
      return { session };
    }),
    201,
  ),
);

/** POST /api/close {session} — forget a session; its comments stay. */
doc.post("/close", (c) =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const raw = yield* jsonBody(c.req.raw);
      const ref = raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).session === "string" ? ((raw as Record<string, unknown>).session as string) : "";
      const session = yield* sessions.resolve(getHome(), ref);
      if (!session) return yield* Effect.fail(sessionNotFound(400));
      const closed = yield* sessions.close(getHome(), session.id);
      return { session: closed };
    }),
  ),
);

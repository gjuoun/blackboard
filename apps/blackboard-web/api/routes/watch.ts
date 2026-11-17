import { basename, dirname } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import type { ChangeBus } from "../../lib/change-bus";
import { type ApiFailure, sessionNotFound } from "../../lib/errors";
import { getHome } from "../../lib/home";
import type { Session, SessionsStore } from "../../lib/sessions";
import { watchEvents } from "../../lib/sse";
import { raw } from "../platform/http/envelope";

const HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

/**
 * GET ?session= — Server-Sent Events. Sends `changed {doc, comments}` batched over 100 ms, so a page
 * can refresh while an agent writes the doc or a comment lands. The doc leg watches the doc's folder;
 * the comments leg is the ChangeBus — the API publishes on every mutation, so the frame a page sees is
 * identical to the folder-watch era.
 */
export const watchRoutes = (sessions: SessionsStore, bus: ChangeBus) => {
  const app = new Hono();

  app.get("/", (c) =>
    raw(
      c,
      Safe.try(function* () {
        const session = (yield sessions.get(
          getHome(),
          new URL(c.req.url).searchParams.get("session") ?? "",
        )) as Session | null;
        if (!session) return (yield Safe.err(sessionNotFound(400))) as never;
        const doc = session.path ? { dir: dirname(session.path), name: basename(session.path) } : undefined;
        return new Response(
          watchEvents({ doc, session: { bus, id: session.id }, signal: c.req.raw.signal }),
          {
            headers: HEADERS,
          },
        );
      }) as unknown as Safe<Response, ApiFailure>,
    ),
  );

  return app;
};

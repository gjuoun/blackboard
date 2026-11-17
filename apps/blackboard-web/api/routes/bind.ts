import { Pipe, Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import type { z } from "zod";
import { BindPostBody, bindReject, decodeBody, jsonBody } from "../../lib/body-schema";
import type { AgentInput, AgentsRepo } from "../../lib/db/repos/agents";
import { type ApiFailure, failures, type InvalidInput, sessionNotFound } from "../../lib/errors";
import { getHome } from "../../lib/home";
import type { Session, SessionsStore } from "../../lib/sessions";
import { json } from "../platform/http/envelope";

/**
 * The agent bridge: a document is bound to the pi session that opened it, and the API posts each
 * submitted comment to the loopback listener that session runs. One record per Blackboard session,
 * in `blackboard.db`'s agents table.
 */

/** The hosts a listener may run on. A binding that points anywhere else is refused. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The listener url, normalized to its origin. Only a plain http loopback address is accepted: this
 * endpoint tells the API where to send a document's comments, so it must not become a way to make
 * the API talk to the network.
 */
function loopbackOrigin(raw: string): Safe<string, InvalidInput> {
  const bad = failures.InvalidInput("url must be a loopback http url", "url", 400);
  return Safe.try(function* () {
    const parsed = (yield (
      Safe.call(
        () => new URL(raw),
        (error) => ({ Bad: error }),
      ) as unknown as Safe<URL, { Bad: unknown }>
    ).pipe(Pipe.catchTag("Bad", () => Safe.ok(null)))) as URL | null;
    if (
      !parsed ||
      parsed.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(parsed.hostname) ||
      parsed.username ||
      parsed.password
    )
      return (yield Safe.err(bad)) as never;
    return parsed.origin;
  }) as unknown as Safe<string, InvalidInput>;
}

/** The session a bind names: an id, or a doc path resolved the way `blackboard open` finds it. */
function bindTarget(
  sessions: SessionsStore,
  req: Request,
): Safe<{ body: z.infer<typeof BindPostBody>; home: string; session: Session }, ApiFailure> {
  return Safe.try(function* () {
    const raw = (yield jsonBody(req)) as unknown | null;
    if (raw === null) return (yield Safe.err(sessionNotFound(400))) as never;
    const body = (yield decodeBody(BindPostBody, raw, bindReject)) as z.infer<typeof BindPostBody>;
    const home = getHome();
    const session = (yield sessions.resolve(home, body.session ?? "")) as Session | null;
    if (!session) return (yield Safe.err(sessionNotFound(400))) as never;
    return { body, home, session };
  }) as unknown as Safe<{ body: z.infer<typeof BindPostBody>; home: string; session: Session }, ApiFailure>;
}

/** The session a GET or DELETE names: the same lookup, without a body. */
function queryTarget(
  sessions: SessionsStore,
  req: Request,
): Safe<{ home: string; session: string }, ApiFailure> {
  return Safe.try(function* () {
    const home = getHome();
    const found = (yield sessions.resolve(
      home,
      new URL(req.url).searchParams.get("session") ?? "",
    )) as Session | null;
    if (!found) return (yield Safe.err(sessionNotFound(400))) as never;
    return { home, session: found.id };
  }) as unknown as Safe<{ home: string; session: string }, ApiFailure>;
}

export const bindRoutes = (agents: AgentsRepo, sessions: SessionsStore) => {
  const app = new Hono();

  /** POST {session, piSession, url} — bind a doc to a pi session's listener. Binding again replaces. */
  app.post("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const { body, home, session } = (yield bindTarget(sessions, c.req.raw)) as {
          body: z.infer<typeof BindPostBody>;
          home: string;
          session: Session;
        };
        const piSession = (body.piSession ?? "").trim();
        if (!piSession)
          return (yield Safe.err(failures.InvalidInput("piSession is required", "piSession", 400))) as never;
        const url = (yield loopbackOrigin((body.url ?? "").trim())) as string;
        const input: AgentInput = { session: session.id, path: session.path, piSession, url };
        return { binding: (yield agents.bind(home, input)) as Awaited<ReturnType<AgentsRepo["bind"]>> };
      }) as unknown as Safe<{ binding: unknown }, ApiFailure>,
    ),
  );

  /** GET ?session= — the binding, or null. Asking counts as a heartbeat. */
  app.get("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const { home, session } = (yield queryTarget(sessions, c.req.raw)) as {
          home: string;
          session: string;
        };
        const binding = (yield agents.get(home, session)) as unknown;
        if (binding) yield agents.touch(home, session);
        return { binding };
      }) as unknown as Safe<{ binding: unknown }, ApiFailure>,
    ),
  );

  /** DELETE ?session= — forget the binding. A session with no binding answers null, not an error. */
  app.delete("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const { home, session } = (yield queryTarget(sessions, c.req.raw)) as {
          home: string;
          session: string;
        };
        const found = (yield agents.unbind(home, session)) as unknown;
        return { unbound: found ? session : null };
      }) as unknown as Safe<{ unbound: string | null }, ApiFailure>,
    ),
  );

  return app;
};

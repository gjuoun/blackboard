import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { AgentsStore, type BindInput } from "@/lib/agents-store";
import { InvalidInput, sessionNotFound, type ApiFailure } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { BindPostBody, bindReject, decodeBody, jsonBody } from "@/lib/effect/schema";
import { getHome } from "@/lib/home";
import { SessionsStore, type Session } from "@/lib/sessions";

/**
 * The agent bridge: a document is bound to the pi session that opened it, and the server posts each
 * submitted comment to the loopback listener that session runs. One record per Blackboard session,
 * in `<home>/agents.json`.
 */

/** The hosts a listener may run on. A binding that points anywhere else is refused. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The listener url, normalized to its origin. Only a plain http loopback address is accepted: this
 * endpoint tells the server where to send a document's comments, so it must not become a way to
 * make the server talk to the network.
 */
function loopbackOrigin(raw: string): Effect.Effect<string, InvalidInput> {
  const bad = new InvalidInput({ message: "url must be a loopback http url", status: 400, field: "url" });
  return Effect.try({ try: () => new URL(raw), catch: () => bad }).pipe(
    Effect.flatMap((parsed) =>
      parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password
        ? Effect.succeed(parsed.origin)
        : Effect.fail(bad),
    ),
  );
}

/** The session a bind names: an id, or a doc path resolved the way `blackboard open` finds it. */
function bindTarget(req: NextRequest): Effect.Effect<{ body: typeof BindPostBody.Type; home: string; session: Session }, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const raw = yield* jsonBody(req);
    if (raw === null) return yield* Effect.fail(sessionNotFound(400));
    const body = yield* decodeBody(BindPostBody, raw, bindReject);
    const home = getHome();
    const session = yield* sessions.resolve(home, body.session ?? "");
    if (!session) return yield* Effect.fail(sessionNotFound(400));
    return { body, home, session };
  });
}

/** The session a GET or DELETE names: the same lookup, without a body. */
function queryTarget(req: NextRequest): Effect.Effect<{ home: string; session: string }, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const home = getHome();
    const found = yield* sessions.resolve(home, req.nextUrl.searchParams.get("session") ?? "");
    if (!found) return yield* Effect.fail(sessionNotFound(400));
    return { home, session: found.id };
  });
}

/** POST {session, piSession, url} — bind a doc to a pi session's listener. Binding again replaces. */
export async function POST(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const agents = yield* AgentsStore;
      const { body, home, session } = yield* bindTarget(req);
      // Decoding already named a missing piSession; an empty string is the same refusal.
      const piSession = (body.piSession ?? "").trim();
      if (!piSession) return yield* Effect.fail(new InvalidInput({ message: "piSession is required", status: 400, field: "piSession" }));
      const url = yield* loopbackOrigin((body.url ?? "").trim());
      const input: BindInput = { session: session.id, path: session.path, piSession, url };
      return { binding: yield* agents.bind(home, input) };
    }),
  );
}

/** GET ?session= — the binding, or null, so an extension can check its own. Asking counts as a heartbeat. */
export async function GET(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const agents = yield* AgentsStore;
      const { home, session } = yield* queryTarget(req);
      const binding = yield* agents.get(home, session);
      // A failed heartbeat is not a failed read: the binding is already in hand.
      if (binding) yield* agents.touch(home, session).pipe(Effect.catch(() => Effect.void));
      return { binding };
    }),
  );
}

/** DELETE ?session= — forget the binding. A session with no binding answers null, not an error. */
export async function DELETE(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const agents = yield* AgentsStore;
      const { home, session } = yield* queryTarget(req);
      const found = yield* agents.unbind(home, session);
      return { unbound: found ? session : null };
    }),
  );
}

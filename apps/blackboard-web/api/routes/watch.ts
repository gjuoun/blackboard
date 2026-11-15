import { basename, dirname } from "node:path";
import { Effect, FileSystem, Stream } from "effect";
import { Hono } from "hono";
import { ChangeBus } from "../../lib/change-bus";
import { sessionNotFound, type ApiFailure } from "../../lib/effect/errors";
import { getHome } from "../../lib/home";
import { SessionsStore } from "../../lib/sessions";
import { docChanges, watchEvents } from "../../lib/sse";
import { respondRaw } from "../respond";

const HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" };

/**
 * GET ?session= — Server-Sent Events. Sends `changed {doc, comments}` batched over 100 ms, so a
 * page can refresh while an agent writes the doc or a comment lands. The doc leg still watches
 * the doc's folder; the comments leg is the ChangeBus — the API publishes on every mutation,
 * so the frame a page sees is identical to the folder-watch era.
 */
export const watch = new Hono();

watch.get("/", (c) => respondRaw(program(c.req.raw)));

function program(req: Request): Effect.Effect<Response, ApiFailure, SessionsStore | FileSystem.FileSystem | ChangeBus> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const fs = yield* FileSystem.FileSystem;
    const bus = yield* ChangeBus;
    const home = getHome();
    const session = yield* sessions.get(home, new URL(req.url).searchParams.get("session") ?? "");
    if (!session) return yield* Effect.fail(sessionNotFound(400));
    const commentEvents = yield* bus.events(session.id);
    // A streamed doc has no file: its saves arrive as bus "doc" marks published by /api/block.
    // Watching dirname("") would watch the server's cwd — the branch must come first.
    const docLeg =
      session.kind === "stream"
        ? yield* bus.docEvents(session.id)
        : docChanges(fs.watch(dirname(session.path)), basename(session.path));
    const events = watchEvents(docLeg, commentEvents);
    const context = yield* Effect.context<SessionsStore | FileSystem.FileSystem | ChangeBus>();
    return new Response(Stream.toReadableStreamWith(events, context, { signal: req.signal }), { headers: HEADERS });
  });
}

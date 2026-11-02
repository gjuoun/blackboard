import { basename, dirname } from "node:path";
import { Effect, FileSystem, Stream } from "effect";
import type { NextRequest } from "next/server";
import { errorMessage, IoFailure, sessionNotFound, type ApiFailure } from "@/lib/effect/errors";
import { respondRaw } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";
import { sessionCommentsPath, SessionsStore } from "@/lib/sessions";
import { commentChanges, docChanges, watchEvents } from "./sse";

const HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" };

/**
 * GET ?session= — Server-Sent Events. Sends `changed {doc, comments}` batched over 100 ms, so a
 * page can refresh while an agent writes the doc or its comments. It watches the doc's folder
 * (not the file: editors that save by rename would drop a file watch) filtered to the doc's name,
 * and the session's comment folder. The watchers live in the readable stream below: cancelling
 * it, or aborting the request, runs their finalizers and closes them.
 */
export async function GET(req: NextRequest) {
  return respondRaw(program(req));
}

function program(req: NextRequest): Effect.Effect<Response, ApiFailure, SessionsStore | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const fs = yield* FileSystem.FileSystem;
    const home = getHome();
    const session = yield* sessions.get(home, req.nextUrl.searchParams.get("session") ?? "");
    if (!session) return yield* Effect.fail(sessionNotFound(400));
    const commentsDir = dirname(sessionCommentsPath(home, session.id));
    yield* fs.makeDirectory(commentsDir, { recursive: true }).pipe(
      Effect.mapError((error) => new IoFailure({ message: errorMessage(error), status: 500 })),
    );
    const events = watchEvents(
      docChanges(fs.watch(dirname(session.path)), basename(session.path)),
      commentChanges(fs.watch(commentsDir)),
    );
    const context = yield* Effect.context<SessionsStore | FileSystem.FileSystem>();
    return new Response(Stream.toReadableStreamWith(events, context, { signal: req.signal }), { headers: HEADERS });
  });
}

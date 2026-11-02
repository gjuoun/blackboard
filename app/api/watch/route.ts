import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { sessionNotFound, type ApiFailure } from "@/lib/effect/errors";
import { respondRaw } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";
import { getSession, sessionCommentsPath } from "@/lib/sessions";

const DEBOUNCE_MS = 100;
const HEARTBEAT_MS = 25_000;

/**
 * GET ?session= — Server-Sent Events. Sends `changed {doc, comments}` batched over 100 ms, so a
 * page can refresh while an agent writes the doc or its comments. It watches the doc's folder
 * (not the file: editors that save by rename would drop a file watch) filtered to the doc's name,
 * and the session's comment folder. The watchers close when the browser disconnects.
 */
export async function GET(req: NextRequest) {
  return respondRaw(program(req));
}

function program(req: NextRequest): Effect.Effect<Response, ApiFailure> {
  return Effect.gen(function* () {
    const home = getHome();
    const session = getSession(home, req.nextUrl.searchParams.get("session") ?? "");
    if (!session) return yield* Effect.fail(sessionNotFound(400));
    const docDir = dirname(session.path);
    const docName = basename(session.path);
    const commentsDir = dirname(sessionCommentsPath(home, session.id));
    yield* Effect.sync(() => mkdirSync(commentsDir, { recursive: true }));
    return yield* live(req, { docDir, docName, commentsDir });
  });
}

/** The stream itself: two folder watchers, a 100 ms debounce and a heartbeat, torn down on disconnect. */
function live(req: NextRequest, dirs: { docDir: string; docName: string; commentsDir: string }): Effect.Effect<Response, ApiFailure> {
  return Effect.gen(function* () {
    const encoder = new TextEncoder();
    const pending = { doc: false, comments: false };
    const state: { controller: ReadableStreamDefaultController<Uint8Array> | null; stopped: boolean; cancelled: boolean } = {
      controller: null,
      stopped: false,
      cancelled: false,
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = (chunk: string) => {
      if (!state.stopped && state.controller) state.controller.enqueue(encoder.encode(chunk));
    };
    const flush = () => {
      timer ??= setTimeout(() => {
        timer = null;
        send(`event: changed\ndata: ${JSON.stringify(pending)}\n\n`);
        pending.doc = false;
        pending.comments = false;
      }, DEBOUNCE_MS);
    };
    const mark = (what: "doc" | "comments") => {
      pending[what] = true;
      flush();
    };
    const watchers: FSWatcher[] = [];
    // A folder that is already gone has nothing to watch; the comment folder must still open.
    const docWatcher = yield* Effect.try(() =>
      watch(dirs.docDir, (_event, filename) => {
        if (filename && filename.toString() === dirs.docName) mark("doc");
      }),
    ).pipe(Effect.catch(() => Effect.succeed(null)));
    if (docWatcher) watchers.push(docWatcher);
    watchers.push(
      yield* Effect.sync(() =>
        watch(dirs.commentsDir, (_event, filename) => {
          const f = filename?.toString() ?? "";
          if (f.endsWith(".tmp") || f.endsWith(".lock")) return;
          mark("comments");
        }),
      ),
    );
    const beat = yield* Effect.sync(() => setInterval(() => send(": ping\n\n"), HEARTBEAT_MS));
    const stop = () => {
      if (state.stopped) return;
      state.stopped = true;
      for (const w of watchers) w.close();
      clearInterval(beat);
      if (timer) clearTimeout(timer);
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        state.controller = controller;
        req.signal.addEventListener("abort", () => {
          stop();
          if (!state.cancelled) controller.close();
        });
        send(": connected\n\n");
      },
      cancel() {
        state.cancelled = true;
        stop();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
    });
  });
}

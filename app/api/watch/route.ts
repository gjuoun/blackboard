import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { NextRequest } from "next/server";
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
  const home = getHome();
  const session = getSession(home, req.nextUrl.searchParams.get("session") ?? "");
  if (!session) return new Response("unknown session", { status: 400 });
  const docDir = dirname(session.path);
  const docName = basename(session.path);
  const commentsDir = dirname(sessionCommentsPath(home, session.id));
  mkdirSync(commentsDir, { recursive: true });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const pending = { doc: false, comments: false };
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer ??= setTimeout(() => {
          timer = null;
          send(`event: changed\ndata: ${JSON.stringify(pending)}\n\n`);
          pending.doc = false;
          pending.comments = false;
        }, DEBOUNCE_MS);
      };
      const watchers: FSWatcher[] = [];
      try {
        watchers.push(
          watch(docDir, (_event, filename) => {
            if (filename && filename.toString() === docName) {
              pending.doc = true;
              flush();
            }
          }),
        );
      } catch {
        // the doc's folder is gone: nothing to watch
      }
      watchers.push(
        watch(commentsDir, (_event, filename) => {
          const f = filename?.toString() ?? "";
          if (f.endsWith(".tmp") || f.endsWith(".lock")) return;
          pending.comments = true;
          flush();
        }),
      );
      const beat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        for (const w of watchers) w.close();
        clearInterval(beat);
        if (timer) clearTimeout(timer);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send(": connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

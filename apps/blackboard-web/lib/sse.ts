import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import type { ChangeBus } from "./change-bus";

const DEBOUNCE_MS = 100;
/** An idle watch connection says something this often: the browser ignores a comment line, and a
 *  proxy or a dead client cannot mistake the stream for a stalled one. 15 s also keeps the write
 *  well inside any intermediate layer's timeout. */
export const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

/** What a batch of changes can name: the doc, its comments, or both. */
type Pending = { doc: boolean; comments: boolean };

export type WatchOptions = {
  /** The doc's folder and file name, when the doc is a file on disk (a session comment has none). */
  doc?: { dir: string; name: string };
  /** The mutation leg: the session whose comment changes matter, when there is one. */
  session?: { bus: ChangeBus; id: string };
  heartbeatMs?: number;
};

/**
 * The event stream /api/watch answers with: `: connected` first, one `changed` batch per 100 ms
 * that has news, and a `: ping` every 15 s (`heartbeatMs`, which tests shorten).
 *
 * Both sources — the doc's folder and the ChangeBus — are subscribed inside `start`, and cancelled
 * inside `cancel`, so a disconnected browser leaves no watcher and no timer behind.
 */
export function watchEvents(options: WatchOptions): ReadableStream<Uint8Array> {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const pending: Pending = { doc: false, comments: false };
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  const stops: Array<() => void> = [];
  let closed = false;

  const stop = () => {
    if (closed) return;
    closed = true;
    if (flushTimer) clearTimeout(flushTimer);
    if (beatTimer) clearInterval(beatTimer);
    for (const off of stops) off();
    stops.length = 0;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(text));
      };
      const flush = () => {
        flushTimer = null;
        if (!pending.doc && !pending.comments) return;
        const data = JSON.stringify(pending);
        pending.doc = false;
        pending.comments = false;
        send(`event: changed\ndata: ${data}\n\n`);
      };
      const mark = (kind: keyof Pending) => {
        pending[kind] = true;
        flushTimer ??= setTimeout(flush, DEBOUNCE_MS);
      };

      send(": connected\n\n");

      // A folder that is already gone has nothing to watch, and that is not a failed request.
      if (options.doc && existsSync(options.doc.dir)) {
        const { dir, name } = options.doc;
        const watcher = watch(dir, (_event, filename) => {
          if (filename !== name) return;
          mark("doc");
        });
        stops.push(() => watcher.close());
      }

      if (options.session) {
        const { bus, id } = options.session;
        stops.push(bus.subscribe(id, () => mark("comments")));
      }

      beatTimer = setInterval(() => send(": ping\n\n"), heartbeatMs);
    },
    cancel() {
      stop();
    },
  });
}
import { watch } from "node:fs";
import type { NextRequest } from "next/server";
import { resolveBoard } from "@/lib/boards";
import { getRoot } from "@/lib/paths";

const DEBOUNCE_MS = 100;
const HEARTBEAT_MS = 25_000;

/**
 * GET ?board= — Server-Sent Events. Sends `changed` with the board-relative paths that changed,
 * batched over 100 ms, so a page can refresh while an agent writes the doc. The watcher closes
 * when the browser disconnects.
 */
export async function GET(req: NextRequest) {
  const boardDir = resolveBoard(getRoot(), req.nextUrl.searchParams.get("board") ?? "");
  if (!boardDir) return new Response("unknown board", { status: 400 });

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
      const pending = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const watcher = watch(boardDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString().split("\\").join("/");
        if (rel.endsWith(".tmp")) return;
        pending.add(rel);
        timer ??= setTimeout(() => {
          timer = null;
          send(`event: changed\ndata: ${JSON.stringify({ paths: [...pending] })}\n\n`);
          pending.clear();
        }, DEBOUNCE_MS);
      });
      const beat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        watcher.close();
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

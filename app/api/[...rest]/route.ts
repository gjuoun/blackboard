import { getHome } from "@/lib/home";
import { apiOrigin } from "@/lib/api-origin";

/**
 * The one /api/* handler the UI owns. The browser keeps its URLs; this forwards each request to the
 * API process unchanged — method, query, body, and the Host the browser used, as x-forwarded-host,
 * so a notify link still names the UI origin. The response body is passed through as a stream, so
 * the SSE watch stream arrives as it is produced.
 */
export const runtime = "nodejs";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "host"]);

/** The browser went away: the request is cancelled, not the API. */
function cancelled(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

/**
 * The upstream body, ending cleanly when the browser is gone. A closed tab cancels the fetch, and the
 * body read then fails; Next turns any non-abort error in the pipe into "failed to pipe response", so
 * a cancellation is closed here instead of being surfaced as a failure.
 */
function relay(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        if (cancelled(signal, error)) controller.close();
        else controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

async function forward(req: Request, { params }: { params: Promise<{ rest: string[] }> }): Promise<Response> {
  const { rest } = await params;
  const url = new URL(req.url);
  const target = `${apiOrigin(getHome())}/api/${rest.map(encodeURIComponent).join("/")}${url.search}`;
  const headers = new Headers();
  for (const [k, v] of req.headers) if (!HOP_BY_HOP.has(k)) headers.set(k, v);
  headers.set("x-forwarded-host", req.headers.get("host") ?? url.host);
  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, redirect: "manual", signal: req.signal };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }
  try {
    const upstream = await fetch(target, init);
    return new Response(relay(upstream.body, req.signal), { status: upstream.status, headers: upstream.headers });
  } catch (error) {
    // A tab that closed mid-request is not the API being down: answer with nothing to pipe.
    if (cancelled(req.signal, error)) return new Response(null, { status: 499 });
    return Response.json({ error: "the API is not running — start it with: blackboard serve start" }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;

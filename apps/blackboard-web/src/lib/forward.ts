import { apiOrigin } from "@/lib/api-origin";
import { getHome } from "@/lib/home";

/**
 * The one `/api/*` handler the UI owns. The browser keeps its URLs; this forwards each request to the
 * API process unchanged — method, query, body, and the Host the browser used, as x-forwarded-host,
 * so a notify link still names the UI origin. The response body is passed through as a stream, so
 * the SSE watch stream arrives as it is produced.
 */

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "host"]);

/** The browser went away: the request is cancelled, not the API. */
function cancelled(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

/** The upstream body, ending cleanly when the browser is gone. */
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

/** `/api/watch?session=x` -> `http://127.0.0.1:38771/api/watch?session=x`. */
export async function forward(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `${apiOrigin(getHome())}${url.pathname}${url.search}`;
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
    if (cancelled(req.signal, error)) return new Response(null, { status: 499 });
    return Response.json({ error: "the API is not running — start it with: blackboard serve start" }, { status: 503 });
  }
}
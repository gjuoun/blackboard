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
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return Response.json({ error: "the API is not running — start it with: blackboard serve start" }, { status: 503 });
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;

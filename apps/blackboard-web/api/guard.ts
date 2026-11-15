import { createMiddleware } from "hono/factory";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Extra hosts the API answers, from $BLACKBOARD_ALLOWED_HOSTS (comma-separated). Same set the
 * UI process honours, so a request that passed the Next forwarder keeps passing here.
 */
const ALLOWED_HOSTS = new Set(
  [
    "blackboard.qqntt.com",
    ...(process.env.BLACKBOARD_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ],
);

/** "localhost:38771" -> "localhost", "[::1]:38771" -> "[::1]". */
function hostname(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

/**
 * The API writes files and a database, so it answers only requests addressed to this machine —
 * the same rules proxy.ts enforced in front of Next: binding 127.0.0.1 stops other machines,
 * checking Host also stops DNS rebinding from a web page, and a cross-site Origin on a write
 * is refused. The middleware is here, not only in the forwarder, because the API can be hit
 * on its own port directly.
 */
export const guard = createMiddleware(async (c, next) => {
  const host = hostname(c.req.header("host") ?? "").toLowerCase();
  if (!LOCAL_HOSTS.has(host) && !ALLOWED_HOSTS.has(host)) {
    return c.text("Forbidden: Blackboard only answers localhost", 403);
  }
  const origin = c.req.header("origin");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin && !isLocalOrigin(origin)) {
    return c.text("Forbidden: cross-site write", 403);
  }
  await next();
});

function isLocalOrigin(origin: string): boolean {
  try {
    const host = hostname(new URL(origin).host).toLowerCase();
    return LOCAL_HOSTS.has(host) || ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

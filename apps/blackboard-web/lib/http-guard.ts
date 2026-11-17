/**
 * The one statement of "who may talk to Blackboard": the rules the API and the UI process both
 * enforce. Framework-free — the Hono middleware and the TanStack request middleware are two
 * adapters over this file, so a change to the rule lands in one place.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Extra hosts the app answers, from $BLACKBOARD_ALLOWED_HOSTS (comma-separated, e.g.
 * "192.168.2.80,mypc.tail123.ts.net"). The production domain is always allowed; the env var only
 * opts extra LAN/tailnet names in. Parsed once, at import.
 */
const ALLOWED_HOSTS = new Set([
  "blackboard.qqntt.com",
  ...(process.env.BLACKBOARD_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
]);

/** "localhost:38770" -> "localhost", "[::1]:38770" -> "[::1]". */
export function hostname(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

/** A Host header this machine answers: loopback, an opted-in name, or the production domain. */
export function hostAllowed(hostHeader: string): boolean {
  const host = hostname(hostHeader).toLowerCase();
  return LOCAL_HOSTS.has(host) || ALLOWED_HOSTS.has(host);
}

/**
 * A write from another site's page. Binding 127.0.0.1 stops other machines and the Host check stops
 * DNS rebinding, but a page on any origin can still send a simple POST to loopback; browsers label
 * those with Origin, so a write whose Origin is not this machine is refused. Reads are left alone.
 */
export function crossSiteWrite(method: string, origin: string | null | undefined): boolean {
  if (method === "GET" || method === "HEAD" || !origin) return false;
  try {
    return !hostAllowed(new URL(origin).host);
  } catch {
    return true;
  }
}

/** The two refusals, in the words both faces print. */
export const DENY_HOST = "Forbidden: Blackboard only answers localhost";
export const DENY_CROSS_SITE = "Forbidden: cross-site write";

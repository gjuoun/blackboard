import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Extra hosts the app answers, from $BLACKBOARD_ALLOWED_HOSTS (comma-separated,
 * e.g. "192.168.2.80,mypc.tail123.ts.net"). The production domain is always
 * allowed; the env var only opts extra (LAN/tailnet) hosts in.
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

/** \"localhost:38770\" -> \"localhost\", \"[::1]:38770\" -> \"[::1]\". */
export function hostname(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

/**
 * The app writes files, so it answers only requests addressed to this machine. Binding
 * 127.0.0.1 stops other machines; checking Host also stops DNS rebinding from a web page.
 * $BLACKBOARD_ALLOWED_HOSTS opts this machine's own LAN/tailnet names in.
 */
export function proxy(request: NextRequest) {
  const host = hostname(request.headers.get("host") ?? "").toLowerCase();
  if (!LOCAL_HOSTS.has(host) && !ALLOWED_HOSTS.has(host)) {
    return new NextResponse("Forbidden: Blackboard only answers localhost", { status: 403 });
  }
  // A page on another site can still send a simple POST to 127.0.0.1 with the right Host.
  // Browsers label those with Origin, so refuse writes whose Origin is not this machine.
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && request.method !== "HEAD" && origin && !isLocalOrigin(origin)) {
    return new NextResponse("Forbidden: cross-site write", { status: 403 });
  }
  return NextResponse.next();
}

function isLocalOrigin(origin: string): boolean {
  try {
    const host = hostname(new URL(origin).host).toLowerCase();
    return LOCAL_HOSTS.has(host) || ALLOWED_HOSTS.has(host);
  } catch {
    return false;
  }
}

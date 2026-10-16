import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** "localhost:38770" -> "localhost", "[::1]:38770" -> "[::1]". */
export function hostname(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

/**
 * The app writes files, so it answers only requests addressed to this machine. Binding
 * 127.0.0.1 stops other machines; checking Host also stops DNS rebinding from a web page.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOSTS.has(hostname(host).toLowerCase())) {
    return new NextResponse("Forbidden: Blackboard only answers localhost", { status: 403 });
  }
  return NextResponse.next();
}

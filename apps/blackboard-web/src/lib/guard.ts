import { createMiddleware } from "@tanstack/react-start";
import { crossSiteWrite, hostAllowed } from "@/lib/http-guard";

/**
 * The UI process's guard — the same rules as the API's, over the same file. A denial here is a
 * plain 403 for the browser (there is no envelope in the UI process); the API answers its own
 * denials in the envelope, which is what a caller of `/api/*` sees.
 */
export const guard = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  if (!hostAllowed(request.headers.get("host") ?? "")) {
    return new Response("Forbidden: Blackboard only answers localhost", { status: 403 });
  }
  if (crossSiteWrite(request.method, request.headers.get("origin"))) {
    return new Response("Forbidden: cross-site write", { status: 403 });
  }
  return next();
});

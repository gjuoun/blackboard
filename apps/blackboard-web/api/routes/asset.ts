import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { type ApiFailure, errorMessage, failures, IoFailure, SessionNotFound } from "../../lib/errors";
import { getHome } from "../../lib/home";
import { type Session, type SessionsStore, servablePath } from "../../lib/sessions";
import { raw } from "../platform/http/envelope";

/**
 * Serves image files that sit next to a registered markdown doc (including subfolders), so
 * `![](./shot.png)` renders in the browser. The renderer points doc-relative img srcs here as
 * `/api/asset/<sessionId>?p=<rel path>` — a query param, so the browser never path-normalises `../`
 * refs away. The doc's own folder is the sandbox: a resolved path that escapes it, or a non-image
 * extension, is a 404.
 */
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

const missing = (message: string) => failures.IoFailure(message, 404);

/** Resolve the doc, the file inside its folder, and the bytes — every refusal is a 404 with its reason. */
function program(sessions: SessionsStore, id: string, relParam: string): Safe<Response, ApiFailure> {
  return Safe.try(function* () {
    const home = getHome();
    const session = (yield sessions.get(home, id)) as Session | null;
    const doc = session === null ? null : servablePath(session);
    if (!doc) return (yield Safe.err(failures.SessionNotFound("no such session", 404))) as never;
    if (relParam === "") return (yield Safe.err(missing("missing p"))) as never;

    const docDir = dirname(doc);
    // `relative` + a prefix check is the containment test: any `..` that escapes the doc's folder (or
    // an absolute p=) makes rel start with ".." and is refused.
    const target = resolve(join(docDir, relParam));
    const rel = relative(docDir, target);
    if (rel.startsWith("..") || rel === "") return (yield Safe.err(missing("outside doc folder"))) as never;

    const type = TYPES[extname(target).toLowerCase()];
    if (!type) return (yield Safe.err(missing("not an image"))) as never;

    const size = (yield Safe.call(
      () => statSync(target).size,
      () => missing("no such image"),
    )) as number;
    if (size === 0) return (yield Safe.err(missing("empty file"))) as never;

    const body = (yield Safe.call(
      () => readFileSync(target),
      (error) => failures.IoFailure(errorMessage(error), 500),
    )) as Buffer;
    // SVG can carry scripts; a CSP header keeps it inert even though it is same-origin.
    const headers: Record<string, string> = {
      "content-type": type,
      "content-length": String(size),
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    };
    if (type === "image/svg+xml")
      headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    return new Response(new Uint8Array(body), { headers });
  });
}

export const assetRoutes = (sessions: SessionsStore) => {
  const app = new Hono();
  app.get("/:id", (c) =>
    raw(c, program(sessions, c.req.param("id"), new URL(c.req.url).searchParams.get("p") ?? "")),
  );
  return app;
};

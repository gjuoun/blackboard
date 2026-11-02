import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import { errorMessage, IoFailure, SessionNotFound, type ApiFailure } from "@/lib/effect/errors";
import { respondRaw } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";
import { SCRATCHPAD_ID, servablePath, SessionsStore } from "@/lib/sessions";

/**
 * Serves image files that sit next to a registered markdown doc (including subfolders), so
 * `![](./shot.png)` renders in the browser. The renderer points doc-relative img srcs here as
 * `/api/asset/<sessionId>?p=<rel path>` — a query param, so the browser never path-normalises
 * `../` refs away. The doc's own folder is the sandbox: a resolved path that escapes it, or a
 * non-image extension, is a 404. The doc itself must still be servable (exists, is markdown,
 * realpaths to itself), which `servablePath` already checks.
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

const missing = (message: string): Effect.Effect<never, ApiFailure> => Effect.fail(new IoFailure({ message, status: 404 }));

function program(req: Request, params: Promise<{ id: string }>): Effect.Effect<Response, ApiFailure, SessionsStore> {
  return Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => params);
    const sessions = yield* SessionsStore;
    const home = yield* Effect.sync(() => getHome());
    if (id === SCRATCHPAD_ID) yield* sessions.scratchpad(home);
    const session = yield* sessions.get(home, id);
    const doc = session === null ? null : yield* Effect.sync(() => servablePath(session));
    if (!doc) return yield* Effect.fail(new SessionNotFound({ message: "no such session", status: 404 }));

    const relParam = new URL(req.url).searchParams.get("p") ?? "";
    if (relParam === "") return yield* missing("missing p");

    const docDir = dirname(doc);
    // `relative` + a prefix check is the containment test: any `..` that escapes the doc's folder
    // (or an absolute p=) makes rel start with ".." and is refused.
    const target = resolve(join(docDir, relParam));
    const rel = relative(docDir, target);
    if (rel.startsWith("..") || rel === "") return yield* missing("outside doc folder");

    const type = TYPES[extname(target).toLowerCase()];
    if (!type) return yield* missing("not an image");

    const size = yield* Effect.tryPromise({
      try: () => stat(target).then((s) => s.size),
      catch: () => new IoFailure({ message: "no such image", status: 404 }),
    });
    if (size === 0) return yield* missing("empty file");

    const body = yield* Effect.tryPromise({
      try: () => readFile(target),
      catch: (error) => new IoFailure({ message: errorMessage(error), status: 500 }),
    });
    // SVG can carry scripts; a CSP header keeps it inert even though it is same-origin.
    const headers: Record<string, string> = {
      "content-type": type,
      "content-length": String(size),
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    };
    if (type === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
    return new Response(new Uint8Array(body), { headers });
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respondRaw(program(req, params));
}

import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { getHome } from "@/lib/home";
import { getSession, SCRATCHPAD_ID, scratchpadSession, servablePath } from "@/lib/sessions";

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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = getHome();
  if (id === SCRATCHPAD_ID) scratchpadSession(home);
  const session = getSession(home, id);
  const doc = session ? servablePath(session) : null;
  if (!doc) return new Response("no such session", { status: 404 });

  const relParam = new URL(req.url).searchParams.get("p") ?? "";
  if (relParam === "") return new Response("missing p", { status: 404 });

  const docDir = dirname(doc);
  // `relative` + a prefix check is the containment test: any `..` that escapes the doc's folder
  // (or an absolute p=) makes rel start with ".." and is refused.
  const target = resolve(join(docDir, relParam));
  const rel = relative(docDir, target);
  if (rel.startsWith("..") || rel === "") return new Response("outside doc folder", { status: 404 });

  const type = TYPES[extname(target).toLowerCase()];
  if (!type) return new Response("not an image", { status: 404 });

  let size: number;
  try {
    size = (await stat(target)).size;
    if (size === 0) return new Response("empty file", { status: 404 });
  } catch {
    return new Response("no such image", { status: 404 });
  }

  const body = await readFile(target);
  // SVG can carry scripts; a CSP header keeps it inert even though it is same-origin.
  const headers: Record<string, string> = {
    "content-type": type,
    "content-length": String(size),
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
  };
  if (type === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  return new Response(new Uint8Array(body), { headers });
}

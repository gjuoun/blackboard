import { isAbsolute } from "node:path";
import { getHome } from "@/lib/home";
import { containedIn, openPath, realFile, registeredRoots } from "@/lib/open-path";
import { listSessions } from "@/lib/sessions";

const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** A positive 1-based position in the query string, or null when the text is not one. */
const position = (s: string) => (/^[1-9]\d{0,8}$/.test(s) ? Number(s) : null);

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** The page a path link opens in its own tab: a confirmation naming the opener that ran, then it closes itself. */
function openedPage(at: string, opener: string): string {
  const shown = at.replace(/[&<>"']/g, (c) => ESCAPE[c]);
  const how = opener.replace(/[&<>"']/g, (c) => ESCAPE[c]);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Opened in the editor</title><body style="font:14px system-ui,sans-serif;padding:24px"><p>已打开 <code>${shown}</code>（${how}）</p><script>window.close()</script></body></html>`;
}

/**
 * Opens a file from a path link in a doc in the editor (`code -g <path>:<line>`, or BLACKBOARD_EDITOR).
 * The file must realpath inside a registered doc's folder or repo root, so the route cannot open
 * arbitrary files. Errors: 400 bad parameters or a `..` segment, 404 no such file in those roots,
 * 409 the editor could not be run. A request from another site is refused (403): a page elsewhere
 * must not be able to open files on this machine by loading the URL.
 */
export async function GET(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return text(403, "cross-site requests are refused");

  const url = new URL(req.url);
  const p = url.searchParams.get("p") ?? "";
  const lText = url.searchParams.get("l");
  const cText = url.searchParams.get("c");
  const line = lText === null ? undefined : position(lText) ?? undefined;
  const col = cText === null ? undefined : position(cText) ?? undefined;
  const bad =
    p === "" || p.includes("\0") || !isAbsolute(p) || p.split("/").includes("..") ||
    (lText !== null && line === undefined) || (cText !== null && (col === undefined || line === undefined));
  if (bad) return text(400, "bad path: expected an absolute path, optional l (line) and c (column)");

  const real = realFile(p);
  if (!real || !containedIn(real, registeredRoots(listSessions(getHome()).map((s) => s.path)))) return text(404, "no such file in a Blackboard doc folder or repo");

  let opener: { label: string };
  try {
    opener = await openPath(real, line, col);
  } catch {
    return text(409, "could not open the file: nothing on PATH could run, set BLACKBOARD_EDITOR to name your editor");
  }
  const at = real + (line ? `:${line}` : "") + (col ? `:${col}` : "");
  return new Response(openedPage(at, opener.label), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

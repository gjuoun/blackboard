/**
 * What kind of document a registered file is. Pure: no filesystem access, so the rule can be
 * tested without a browser or a temp home.
 *
 * - `doc`: a Markdown file opened as a plain or PR document (today's behaviour).
 * - `code`: a source file from the allowlist below, shown as its own text with a workspace rail.
 * - `stream`: a `.jsonl` file with one block per line, written by agents with `blackboard block`.
 */

export type DocType = "doc" | "code" | "stream";
export type RegisterKind = "plain" | "pr" | "stream";

export const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "sh", "py", "go", "rs", "yml", "toml"] as const;

/** Largest code file the page will read. Bigger files are refused at registration. */
export const CODE_MAX_BYTES = 1024 * 1024;

export const extOf = (path: string) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
};

/**
 * The type of a file given the kind it was registered with. Returns the type, or a message for a
 * pairing that is refused. A `.jsonl` file is a stream only when registered with `--kind stream`,
 * so a stream is never inferred from its name alone.
 */
export function docType(path: string, kind: RegisterKind = "plain"): { ok: true; type: DocType } | { ok: false; error: string } {
  const e = extOf(path);
  if (kind === "stream") {
    return e === "jsonl" ? { ok: true, type: "stream" } : { ok: false, error: `a stream must be a .jsonl file: ${path}` };
  }
  if (e === "md") return { ok: true, type: "doc" };
  if (e === "jsonl") return { ok: false, error: `a .jsonl file needs --kind stream: ${path}` };
  if ((CODE_EXTENSIONS as readonly string[]).includes(e) && kind === "plain") return { ok: true, type: "code" };
  if ((CODE_EXTENSIONS as readonly string[]).includes(e)) return { ok: false, error: `--kind ${kind} takes a Markdown file: ${path}` };
  return { ok: false, error: `not a markdown or supported source file: ${path}` };
}

/** Whether a path may be registered at all. Used by `realDoc` before it reads the file. */
export function servableExtension(path: string): boolean {
  const e = extOf(path);
  return e === "md" || e === "jsonl" || (CODE_EXTENSIONS as readonly string[]).includes(e);
}

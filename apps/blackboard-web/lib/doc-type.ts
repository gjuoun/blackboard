/**
 * What kind of document a registered file is. Pure: no filesystem access, so the rule can be
 * tested without a browser or a temp home.
 *
 * - `doc`: a Markdown file opened as a plain document.
 * - `code`: a source file from the allowlist below, shown as its own text.
 */

export type DocType = "doc" | "code";

export const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "sh", "py", "go", "rs", "yml", "toml"] as const;

/** Largest code file the page will read. Bigger files are refused at registration. */
export const CODE_MAX_BYTES = 1024 * 1024;

export const extOf = (path: string) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
};

/**
 * The type of a registered file, or a message for a file this app does not serve. A `.jsonl` file
 * is refused: it was a streaming document, and those are gone.
 */
export function docType(path: string): { ok: true; type: DocType } | { ok: false; error: string } {
  const e = extOf(path);
  if (e === "md") return { ok: true, type: "doc" };
  if ((CODE_EXTENSIONS as readonly string[]).includes(e)) return { ok: true, type: "code" };
  return { ok: false, error: `not a markdown or supported source file: ${path}` };
}

/** Whether a path may be registered at all. Used by `realDoc` before it reads the file. */
export function servableExtension(path: string): boolean {
  const e = extOf(path);
  return e === "md" || (CODE_EXTENSIONS as readonly string[]).includes(e);
}

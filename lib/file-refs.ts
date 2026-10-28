import type { Element, Root as HastRoot } from "hast";
import { visit } from "unist-util-visit";
import { normalizeRepoPath, type DiffSnapshot } from "./diff-index";

/**
 * Explicit file links: `file:<repo-relative-path>:L<a>-<b>`. A link without a path
 * (`file:L330-240`) means the current document's file; a reversed range is normalized.
 * Only markdown links are rewritten — prose and fenced code never become file links.
 */
export type FileRef = { path: string | null; start: number | null; end: number | null };
export type LineRange = { start: number; end: number };

const SHORT = /^L(\d+)(?:-L?(\d+))?$/;
const TAIL = /^(.*?):L(\d+)(?:-L?(\d+))?$/;

const toLine = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Swap a reversed range and reject nonsense. A single line keeps start === end. */
export function normalizeRange(start: number | null, end: number | null): LineRange | null {
  if (start === null) return null;
  const a = start;
  const b = end ?? start;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < 1) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Parse a `file:` href. Null means "not a recognized file link". */
export function parseFileRef(href: string): FileRef | null {
  if (!href.startsWith("file:")) return null;
  const rest = href.slice(5);
  if (!rest) return null;
  const short = SHORT.exec(rest);
  if (short) {
    const range = normalizeRange(toLine(short[1]), toLine(short[2]));
    return range ? { path: null, ...range } : null;
  }
  const tail = TAIL.exec(rest);
  if (tail) {
    const path = normalizeRepoPath(tail[1]);
    if (!path) return null;
    const range = normalizeRange(toLine(tail[2]), toLine(tail[3]));
    return range ? { path, ...range } : null;
  }
  const path = normalizeRepoPath(rest);
  return path ? { path, start: null, end: null } : null;
}

export type FileLinkOptions = {
  /** The one snapshot the request built; the visitor reads metadata only. */
  index: DiffSnapshot;
  /** Repository-relative path of the document being rendered, for `file:L…` shorthand. */
  docPath: string | null;
  /** The selected file/range from the query string, so its link paints active. */
  selected?: { path: string; start: number | null; end: number | null } | null;
};

const encode = (value: string) => encodeURIComponent(value);

/** The session-relative URL a file link points at. Query-only, so it keeps the current path. */
export function fileHref(path: string, range: LineRange | null): string {
  const q = ["tab=pr", "file=" + encode(path)];
  if (range) q.push("L=" + (range.start === range.end ? "L" + range.start : "L" + range.start + "-L" + range.end));
  return "?" + q.join("&");
}

/** The Local PR file list, or the Comments tab. */
export const prListHref = () => "?tab=pr";
export const tabHref = (tab: "comments" | "pr") => "?tab=" + tab;

export type SelectedFile = { path: string; start: number | null; end: number | null };

/** Read `file` and `L` from the page query. Unknown or escaped paths yield null. */
export function parseSelectedFile(search: { file?: string | string[]; L?: string | string[] }, docPath: string | null): SelectedFile | null {
  const raw = Array.isArray(search.file) ? search.file[0] : search.file;
  if (!raw) return null;
  let path: string | null = null;
  let start: number | null = null;
  let end: number | null = null;
  const shorthand = /^L(\d+)(?:-L?(\d+))?$/.exec(raw);
  if (shorthand && docPath) {
    path = docPath;
    start = toLine(shorthand[1]);
    end = toLine(shorthand[2]);
  } else {
    path = normalizeRepoPath(raw);
  }
  if (!path) return null;
  const rawL = Array.isArray(search.L) ? search.L[0] : search.L;
  const lines = rawL ? /^L?(\d+)(?:-L?(\d+))?$/.exec(rawL) : null;
  if (lines) {
    start = toLine(lines[1]);
    end = toLine(lines[2]);
  }
  const range = normalizeRange(start, end);
  return { path, start: range?.start ?? null, end: range?.end ?? null };
}

const classList = (el: Element): string[] => (Array.isArray(el.properties.className) ? (el.properties.className as string[]) : []);

/** Rewrite the recognized markdown links in a HAST tree; every answer comes from the index. */
export function rehypeFileRefs(opts: FileLinkOptions) {
  return (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      if (el.tagName !== "a") return;
      const href = el.properties.href;
      if (typeof href !== "string") return;
      const ref = parseFileRef(href);
      if (!ref) return;
      const path = ref.path ?? opts.docPath;
      if (!path) return;
      const range = normalizeRange(ref.start, ref.end);
      const file = opts.index.file(path);
      el.properties.href = fileHref(path, range);
      el.properties.className = [...classList(el), "file-ref", file ? "" : "file-ref-missing"].filter(Boolean);
      el.properties.dataFile = path;
      if (range) el.properties.dataRange = "L" + range.start + "-L" + range.end;
      el.properties.title = path + (range ? ":L" + range.start + "-L" + range.end : "");
      const selected = opts.selected;
      if (selected && selected.path === path && (range === null || (selected.start === range.start && selected.end === range.end))) {
        el.properties["aria-current"] = "true";
        el.properties.className = [...classList(el), "file-ref-active"];
      }
    });
  };
}

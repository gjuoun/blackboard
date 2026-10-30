import type { LineRange } from "./file-refs";

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
/** The full Local PR list, even when the document references only some of its files. */
export const prAllHref = () => "?tab=pr&all=1";
/** The `all` switch is a server choice: only the literal `1` expands the list. */
export const parseShowAll = (raw: string | string[] | undefined): boolean => (Array.isArray(raw) ? raw[0] : raw) === "1";

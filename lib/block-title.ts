/**
 * The title a timeline entry shows for a stream block, in this order:
 *   1. the block body's first heading (`#` to `######`),
 *   2. else its first non-empty line, with markdown markers removed and cut to 40 characters,
 *   3. else `第 N 块`, so a block with no text still has a label.
 */
import type { StreamBlock } from "./stream-doc";

export const TITLE_MAX_CHARS = 40;

/** Markdown markers that carry no words: heading and quote marks, list bullets, emphasis, inline code, link brackets. */
function plain(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s{0,3}>\s?/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts to `max` characters (code points, so CJK and emoji are never split), adding an ellipsis when cut. */
export function clip(text: string, max = TITLE_MAX_CHARS): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("") + "…";
}

export function blockTitle(b: Pick<StreamBlock, "body" | "n">): string {
  const heading = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(b.body);
  if (heading) return heading[1].trim();
  for (const line of b.body.split("\n")) {
    const text = plain(line);
    if (text) return clip(text);
  }
  return `第 ${b.n} 块`;
}

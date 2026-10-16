import type { Comment } from "./comments-store";

const quoteLines = (s: string) =>
  s
    .trim()
    .split(/\n+/)
    .map((l) => `> ${l.trim()}`)
    .join("\n");

/**
 * Open comments for one doc as markdown, ready to paste to an agent: the quoted passage, then
 * the note, then replies. Resolved comments are left out; orphaned ones say so.
 */
export function exportComments(board: string, doc: string, comments: (Comment & { orphaned?: boolean })[]): string {
  const open = comments.filter((c) => c.status === "open");
  const title = `## ${board}/${doc} — ${open.length === 0 ? "no" : open.length} open comment${open.length === 1 ? "" : "s"}`;
  if (open.length === 0) return title + "\n";
  const blocks = open.map((c) => {
    const parts = [quoteLines(c.quote.exact)];
    if (c.orphaned) parts.push("_(passage no longer in the doc)_");
    parts.push([`**${c.author}:** ${c.body}`, ...c.replies.map((r) => `- **${r.author}:** ${r.body}`)].join("\n"));
    return parts.join("\n\n");
  });
  return `${title}\n\n${blocks.join("\n\n---\n\n")}\n`;
}

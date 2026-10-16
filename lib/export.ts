import type { Comment } from "./comments-store";

const quoteLines = (s: string) =>
  s
    .trim()
    .split(/\n+/)
    .map((l) => `> ${l.trim()}`)
    .join("\n");

/**
 * Open comments for one doc as markdown, ready to paste to an agent: the doc's title and file,
 * then per comment the quoted passage, the note and replies. Resolved comments are left out;
 * orphaned ones say so.
 */
export function exportComments(title: string, path: string, comments: (Comment & { orphaned?: boolean })[]): string {
  const open = comments.filter((c) => c.status === "open");
  const head = `## ${title} — ${open.length === 0 ? "no" : open.length} open comment${open.length === 1 ? "" : "s"}\n\nFile: \`${path}\``;
  if (open.length === 0) return head + "\n";
  const blocks = open.map((c) => {
    const parts = [quoteLines(c.quote.exact)];
    if (c.orphaned) parts.push("_(passage no longer in the doc)_");
    parts.push([`**${c.author}:** ${c.body}`, ...c.replies.map((r) => `- **${r.author}:** ${r.body}`)].join("\n"));
    return parts.join("\n\n");
  });
  return `${head}\n\n${blocks.join("\n\n---\n\n")}\n`;
}

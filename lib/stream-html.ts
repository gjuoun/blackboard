/**
 * The stream body as HTML: one section per block, each with its header and its markdown rendered on its own.
 * No block reads the filesystem and no block depends on another, so the page cost is the sum of the blocks.
 */
import { ACTION_LABEL, type StreamBlock } from "./stream-doc";
import { renderMarkdown } from "./markdown";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The side rule of a block: amber for an edit to the text, primary for an append, none for an answer. */
const RULE: Record<StreamBlock["action"], string> = { answer: "", edit: "stream-rule-edit", append: "stream-rule-append" };

export async function renderStream(blocks: readonly StreamBlock[]): Promise<string> {
  const parts: string[] = [];
  for (const b of blocks) {
    const { html } = await renderMarkdown(b.body);
    const writing = b.status === "writing";
    parts.push(
      `<section id="${esc(b.id)}" class="stream-block ${RULE[b.action]}" data-testid="stream-block" data-id="${esc(b.id)}" data-n="${b.n}" data-action="${b.action}">` +
        `<header class="stream-head"><span class="stream-pill">${ACTION_LABEL[b.action]}</span> <span class="text-muted-foreground text-xs">${esc(b.author)} · ${esc(b.at)}</span></header>` +
        `<div class="doc-body">${html}</div>` +
        (writing ? `<p class="stream-writing text-muted-foreground text-xs">agent 正在写第 ${b.n} 块…</p>` : "") +
      `</section>`,
    );
  }
  return parts.join("\n");
}

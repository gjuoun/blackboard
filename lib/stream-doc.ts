/**
 * The exchange model of a streamed document: a list of blocks, each one an `answer`, an `edit`
 * or an `append` by someone. This module is pure — no database, no Effect — so the UI bundle and
 * tests can use the shapes and the fold without reaching `blackboard.db`. The rows live in the
 * `blocks` table; reading them into `StreamBlock`s is `BlocksRepo`'s job.
 *
 * The fold rule gives every block list a single markdown view (the value `documents.body`
 * carries): `answer` and `append` extend the running text; `edit` carries the corrected whole
 * document and replaces it, so an edit makes the earlier blocks stop contributing to the view.
 * `documents.body` is always recomputable from the blocks — never edited directly.
 */

export const STREAM_ACTIONS = ["answer", "edit", "append"] as const;
export type StreamAction = (typeof STREAM_ACTIONS)[number];

/** One exchange, as the `blocks` table holds it (`n` is 1-based within its document). */
export type StreamBlock = {
  id: string;
  n: number;
  action: StreamAction;
  author: string;
  /** Markdown of the block body. An `edit` block carries the corrected whole document. */
  body: string;
  images?: string[] | null;
  /** "writing" while the exchange is still open. At most the last block is writing. */
  status?: "writing" | null;
  at: string;
};

/** The action label each exported block header shows. */
export const ACTION_LABEL: Record<StreamAction, string> = { answer: "长答", edit: "改正文", append: "追加" };

/** The exchange number the next block gets: 1-based, after the highest one present. */
export const nextN = (blocks: readonly StreamBlock[]): number =>
  blocks.reduce((m, b) => Math.max(m, b.n), 0) + 1;

/** One block's body, without trailing whitespace, terminated by a newline. */
const section = (body: string): string => body.replace(/\s+$/, "") + "\n";

/**
 * The document as one markdown text: `answer` and `append` extend the running body, `edit`
 * replaces it. Blocks are read in `n` order; the caller passes them sorted. Empty when there
 * are no blocks — a stream with zero exchanges shows an empty document, never an error.
 */
export function foldBlocks(blocks: readonly StreamBlock[]): string {
  let body = "";
  for (const b of blocks) {
    if (b.action === "edit") {
      body = section(b.body);
    } else {
      body = body === "" ? section(b.body) : body + "\n" + section(b.body);
    }
  }
  return body;
}

/**
 * Markdown export: one `##` section per block, headed by its action, author and time — the same
 * shape the pre-SQLite `.jsonl` era wrote. A block still open ends its heading with " · writing".
 */
export function exportStream(blocks: readonly StreamBlock[], title: string): string {
  const parts = [`# ${title}`, ""];
  for (const b of blocks) {
    const writing = b.status === "writing" ? " · writing" : "";
    parts.push(`## ${b.n}. ${ACTION_LABEL[b.action]} · ${b.author} · ${b.at}${writing}`, "", b.body.replace(/\s+$/, ""), "");
  }
  return parts.join("\n");
}

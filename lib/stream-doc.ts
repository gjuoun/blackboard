/**
 * A streaming document: one JSON object per line in a `.jsonl` file, one block per line, and an `id` appears
 * once. There is no event log in the file: changing a block rewrites the file (see stream-store.ts).
 *
 * Parsing is pure. A line that is not a block is skipped and counted. A second line with an `id` already seen
 * is also skipped and counted, never merged: the first occurrence wins, so a duplicate is visible in `skipped`
 * instead of silently replacing a block.
 */

export const STREAM_ACTIONS = ["answer", "edit", "append"] as const;
export type StreamAction = (typeof STREAM_ACTIONS)[number];

export type StreamBlock = {
  id: string;
  n: number;
  action: StreamAction;
  author: string;
  at: string;
  /** Markdown of the block body. Rendered per block by the page, never as one document. */
  body: string;
  images?: string[];
  status?: "writing";
};

export type ParsedStream = { blocks: StreamBlock[]; skipped: number };

/** The action label each block header shows. */
export const ACTION_LABEL: Record<StreamAction, string> = { answer: "长答", edit: "改正文", append: "追加" };

function asBlock(v: unknown): StreamBlock | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.n !== "number" || !Number.isInteger(o.n)) return null;
  if (typeof o.action !== "string" || !(STREAM_ACTIONS as readonly string[]).includes(o.action)) return null;
  if (typeof o.author !== "string" || typeof o.at !== "string" || typeof o.body !== "string") return null;
  const images = Array.isArray(o.images) && o.images.every((x) => typeof x === "string") ? (o.images as string[]) : undefined;
  return {
    id: o.id,
    n: o.n,
    action: o.action as StreamAction,
    author: o.author,
    at: o.at,
    body: o.body,
    ...(images ? { images } : {}),
    ...(o.status === "writing" ? { status: "writing" as const } : {}),
  };
}

/** Blocks in file order. Bad lines and repeated ids are counted in `skipped`, never thrown on. */
export function parseStream(text: string): ParsedStream {
  const byId = new Map<string, StreamBlock>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let block: StreamBlock | null = null;
    try {
      block = asBlock(JSON.parse(line));
    } catch {
      block = null;
    }
    if (!block || byId.has(block.id)) {
      skipped++;
      continue;
    }
    byId.set(block.id, block);
  }
  const blocks = [...byId.values()];
  return { blocks, skipped };
}

/** Markdown export: one `##` section per block, headed by its action and author. Used by the cloud mirror. */
export function exportStream(blocks: readonly StreamBlock[], title: string): string {
  const parts = [`# ${title}`, ""];
  for (const b of blocks) {
    parts.push(`## ${b.n}. ${ACTION_LABEL[b.action]} · ${b.author} · ${b.at}`, "", b.body.replace(/\s+$/, ""), "");
  }
  return parts.join("\n");
}

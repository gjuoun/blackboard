/**
 * A streaming document: one JSON object per line in a `.jsonl` file. Appending a block appends one line;
 * a later line with the same `id` replaces the earlier one (last line wins), so a status change is also an
 * append. Parsing is pure: it takes the text and returns the blocks in order.
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

/** Fold the lines into blocks: last line wins per id, then sorted by n. Bad lines are counted, not thrown on. */
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
    if (!block) {
      skipped++;
      continue;
    }
    byId.set(block.id, block);
  }
  const blocks = [...byId.values()].sort((a, b) => a.n - b.n);
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

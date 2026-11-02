/**
 * A streaming document: one JSON object per line in a `.jsonl` file. Line 1 is the document's own
 * metadata (its stable id and its title); every later line is one block, and a block `id` appears once.
 * There is no event log in the file: changing a block rewrites the file (see stream-store.ts).
 *
 * Older files have no metadata line and no `type` on their blocks: the first line is a block, so
 * `meta` is null and `legacy` is true. Those files keep parsing exactly as they always did.
 *
 * Parsing is pure. A line that is not a block and not the first metadata line is skipped and counted.
 * A second line with an `id` already seen is also skipped and counted, never merged: the first
 * occurrence wins, so a duplicate is visible in `skipped` instead of silently replacing a block.
 * A metadata line is never a block, and a block line is never the metadata.
 */
import { ulid } from "./ulid";

export const STREAM_ACTIONS = ["answer", "edit", "append"] as const;
export type StreamAction = (typeof STREAM_ACTIONS)[number];

/** Schema version written into the metadata line. Readers ignore unknown keys and accept newer integers. */
export const STREAM_META_VERSION = 1;

/** The document itself: stable id, title, kind and creation time. Later versions may add keys. */
export type StreamMeta = {
  type: "meta";
  v: number;
  /** Document-level ULID with the `s-` prefix. Never changes once assigned. */
  id: string;
  title: string;
  kind: "stream";
  created: string;
  owner?: string;
};

export type StreamBlock = {
  /** The line's discriminator. Old files omit it; the parser still reads them. */
  type: "block";
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

export type ParsedStream = {
  /** The document's metadata, or null for an old file with no metadata line. */
  meta: StreamMeta | null;
  /** True when the file has no metadata line (old files and empty files). */
  legacy: boolean;
  blocks: StreamBlock[];
  skipped: number;
};

/** The action label each block header shows. */
export const ACTION_LABEL: Record<StreamAction, string> = { answer: "长答", edit: "改正文", append: "追加" };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * One parsed metadata line, or null when the shape is not usable. A missing or non-string title is
 * exactly why a line is refused: the line is counted in `skipped` and the blocks still parse.
 */
export function parseMeta(v: unknown): StreamMeta | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.type !== "meta") return null;
  if (typeof o.v !== "number" || !Number.isInteger(o.v) || o.v < 1) return null;
  if (!nonEmpty(o.id) || !nonEmpty(o.title) || o.kind !== "stream" || !nonEmpty(o.created)) return null;
  return {
    type: "meta",
    v: o.v,
    id: o.id,
    title: o.title,
    kind: "stream",
    created: o.created,
    ...(nonEmpty(o.owner) ? { owner: o.owner } : {}),
  };
}

/** A fresh metadata record: a new `s-` ULID and the current time, in the file's key order. */
export function newStreamMeta(input: { title: string; owner?: string }, at = new Date().toISOString()): StreamMeta {
  return {
    type: "meta",
    v: STREAM_META_VERSION,
    id: `s-${ulid()}`,
    title: input.title,
    kind: "stream",
    created: at,
    ...(input.owner ? { owner: input.owner } : {}),
  };
}

/** The metadata as the file's first line. */
export const metaLine = (meta: StreamMeta): string => JSON.stringify(meta);

/** The block as its line. The `type` key serialises first, as in the spec's example. */
export const blockLine = (block: StreamBlock): string => JSON.stringify(block);

function asBlock(v: unknown): StreamBlock | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  // A line may carry a type; anything except "block" is not a block (a meta line never is one).
  if (o.type !== undefined && o.type !== "block") return null;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.n !== "number" || !Number.isInteger(o.n)) return null;
  if (typeof o.action !== "string" || !(STREAM_ACTIONS as readonly string[]).includes(o.action)) return null;
  if (typeof o.author !== "string" || typeof o.at !== "string" || typeof o.body !== "string") return null;
  const images = Array.isArray(o.images) && o.images.every((x) => typeof x === "string") ? (o.images as string[]) : undefined;
  return {
    type: "block",
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
  let meta: StreamMeta | null = null;
  let skipped = 0;
  let first = true;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    const type = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).type : undefined;
    if (first) {
      first = false;
      if (type === "meta") {
        const parsed = parseMeta(value);
        if (parsed) {
          meta = parsed;
          continue;
        }
        skipped++;
        continue;
      }
    }
    // The metadata lives on line 1 only; any other meta line is neither metadata nor a block.
    if (type === "meta") {
      skipped++;
      continue;
    }
    const block = asBlock(value);
    if (!block || byId.has(block.id)) {
      skipped++;
      continue;
    }
    byId.set(block.id, block);
  }
  return { meta, legacy: meta === null, blocks: [...byId.values()], skipped };
}

/** Markdown export: one `##` section per block, headed by its action and author. Used by the cloud mirror. */
export function exportStream(blocks: readonly StreamBlock[], title: string): string {
  const parts = [`# ${title}`, ""];
  for (const b of blocks) {
    parts.push(`## ${b.n}. ${ACTION_LABEL[b.action]} · ${b.author} · ${b.at}`, "", b.body.replace(/\s+$/, ""), "");
  }
  return parts.join("\n");
}

/**
 * The stream-payload window: which exchanges the server renders into the first screen and how
 * tall each exchange probably is. Everything here is pure — the page, the api and the lazy
 * loader's tests share one answer. A block under the line is sent whole; a block outside the
 * window is a placeholder section whose height is the same estimate this file computes.
 */
import type { StreamBlock } from "./stream-doc";

/** Below this many exchanges the timeline is small enough to send whole. */
export const FULL_RENDER_THRESHOLD = 120;

/** The head window's hard bounds: never fewer than 8, never more than 48 exchanges. */
const HEAD_MIN = 8;
const HEAD_MAX = 48;

/** One exchange's markdown may estimate at most this much rendered HTML before the head stops. */
const HEAD_BLOCK_BYTES = 8 * 1024;

/** How many placeholders past the window still carry their meta line. Farther out, a
 *  placeholder is only an id, an estimate and a height: at 300 skipped exchanges the meta
 *  lines alone would outweigh the text the first screen actually ships. */
export const PENDING_META_BAND = 24;

/** A viewport the server cannot see gets this default; the bbvh cookie or ?vh= overrides it. */
export const DEFAULT_VIEWPORT_H = 900;

/**
 * Rough pixel height of one rendered exchange section: 24px of meta line, then the markdown,
 * which measures out at ~1.25px per source character (a measured 268-character exchange
 * renders 349px tall; 24 + 1.25 * 268 = 359). Text volume is the term that dominates — a
 * line-type model undercounted by 11% on the same fixture, and an 11% error accumulated over
 * 300 blocks put the virtualizer's window 20 blocks away from where the DOM actually is.
 * Only the estimate seeds geometry: every mounted block is replaced by its measured height.
 */
export function estimateBlockHeight(body: string): number {
  const images = body.split("\n").filter((l) => l.trim().startsWith("![")).length;
  return Math.min(900, Math.max(72, Math.round(24 + body.length * 1.25 + images * 200)));
}

/** Rough byte size of the rendered HTML for one exchange; markdown markup inflates it ~20%. */
export function estimateBlockHtmlBytes(body: string): number {
  return Math.ceil(body.length * 1.2) + 240;
}

export type StreamWindow = {
  /** Indexes rendered into the first screen (the head window). */
  head: readonly number[];
  /** Indexes always rendered as the tail: the last exchange (the writing block lives there). */
  tail: readonly number[];
  total: number;
  /** Fingerprint of the block list: `total:Σbody.length`. Changes whenever the stream does. */
  epoch: string;
  /** Per-block estimated heights, index-aligned with the block list. */
  estimates: readonly number[];
};

/**
 * Which exchanges the first screen renders. `viewportH` is the reader's window height when the
 * server knows it (bbvh cookie, ?vh= override), else 900. The head covers the viewport plus a
 * viewport and a half of overscan, measured on the estimates; the tail keeps the last exchange
 * mounted so the writing block and the follow behaviour have a real DOM node.
 */
export function planStreamWindow(blocks: readonly Pick<StreamBlock, "body">[], viewportH = DEFAULT_VIEWPORT_H): StreamWindow {
  const total = blocks.length;
  const estimates = blocks.map((b) => estimateBlockHeight(b.body));
  const epoch = `${total}:${blocks.reduce((n, b) => n + b.body.length, 0)}`;
  if (total <= FULL_RENDER_THRESHOLD) return { head: blocks.map((_, i) => i), tail: [], total, epoch, estimates };

  const budget = Math.max(DEFAULT_VIEWPORT_H, viewportH + viewportH * 1.5);
  const head: number[] = [];
  let height = 0;
  for (let i = 0; i < total - 1; i++) {
    const b = blocks[i];
    const tooTall = head.length >= HEAD_MAX;
    const overBudget = height >= budget && head.length >= HEAD_MIN;
    const overBytes = estimateBlockHtmlBytes(b.body) > HEAD_BLOCK_BYTES && head.length >= HEAD_MIN;
    if (tooTall || overBudget || overBytes) break;
    head.push(i);
    height += estimates[i];
  }
  const tail = [total - 1];
  return { head, tail, total, epoch, estimates };
}

/** The `stream` object `/api/session` returns alongside a windowed response. */
export type StreamWindowMeta = { total: number; epoch: string; vh: number; estimates: readonly number[] };

/** Serialize the window into the api response shape. */
export const windowMeta = (w: StreamWindow, vh: number): StreamWindowMeta => ({ total: w.total, epoch: w.epoch, vh, estimates: w.estimates });

/** Slice `range=from:to` params (0-based, inclusive, clamped; `to` beyond the end clamps). */
export function parseRange(raw: string | null, total: number): { from: number; to: number } | null | "invalid" {
  if (raw == null) return null;
  const m = /^(\d+)(?::(\d*))?$/.exec(raw.trim());
  if (!m) return "invalid";
  const from = Math.min(total, Math.max(0, Number(m[1])));
  const to = m[2] === undefined ? from : Math.min(Math.max(from, total - 1), Number(m[2]));
  if (to < from) return "invalid";
  return { from, to };
}

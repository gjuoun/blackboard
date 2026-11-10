/**
 * The pure model of the virtualized doc body: how the rendered top-level elements chunk into
 * blocks, how heights (measured or estimated) become offsets, which blocks the viewport wants,
 * and how a late height change above the viewport is paid back to the scroll position. Ported
 * from the approved sketch (`sketches/virtualized-doc/virtualizer.js`, the design record); the
 * DOM half that mounts blocks between spacers lives in `lib/virtualize-dom.ts`. No DOM here, so
 * everything is testable outside a browser.
 */

/** One chunked block: its element's tag, its own margins (px), and the collapsed margin (px)
 *  between it and the next block. */
export type VBlock = { kind: string; marginTop: number; marginBottom: number; gapAfter: number };

/** An id (heading or top-level element) pointing into a block, `within` px from the block's top. */
export type VAnchor = { id: string; within: number };

/** What the chunker reads off one top-level element while it is still in normal flow. */
export type ChunkInput = { kind: string; marginTop: number; marginBottom: number; anchors: VAnchor[] };

export type VPlan = {
  blocks: VBlock[];
  /** Every id worth jumping to: top-level element ids and heading ids (including nested ones). */
  anchors: Map<string, { i: number; within: number }>;
};

/** Rough content heights per top-level kind, in px, for blocks never measured yet. They only
 *  seed the scrollbar geometry: every block is re-measured the moment it mounts, so a wrong
 *  estimate never moves text the reader can see (the sketch proved this convergence). */
const ESTIMATES: Record<string, number> = {
  h1: 38, h2: 36, h3: 26, h4: 24, p: 64, ul: 92, ol: 92, pre: 78, table: 140, blockquote: 65, hr: 1,
};

/** The estimate for a kind; unknown kinds get the paragraph's height. */
export const estimateFor = (kind: string): number => ESTIMATES[kind] ?? 64;

/**
 * Chunk the flow children into a plan. The blocks keep their own margins and stay in normal
 * flow when mounted; only the collapsed margin between neighbours (`max` of the two touching
 * margins — this app's CSS has no negative ones) moves into the model, as `gapAfter`. The last
 * block has no gap: the article's height ends at its content, as it does in flow, where the
 * final margin escapes the parent.
 */
export function planChunks(children: ChunkInput[]): VPlan {
  const blocks: VBlock[] = [];
  const anchors = new Map<string, { i: number; within: number }>();
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    const next = children[i + 1];
    blocks.push({ kind: c.kind, marginTop: c.marginTop, marginBottom: c.marginBottom, gapAfter: next ? Math.max(c.marginBottom, next.marginTop) : 0 });
    for (const a of c.anchors) anchors.set(a.id, { i, within: a.within });
  }
  return { blocks, anchors };
}

/** A block's measured height, or its kind's estimate while never mounted. The space it consumes
 *  in the model is that plus its collapsed gap to the next block. */
export function heightAt(heights: ReadonlyArray<number | null>, blocks: readonly VBlock[], i: number): number {
  return heights[i] ?? estimateFor(blocks[i].kind);
}

/** Prefix sums of the space each block consumes: `offsets[i]` is block i's top (its border-box
 *  top, exactly where flow puts it), `offsets[n]` the total. */
export function rebuildOffsets(heights: ReadonlyArray<number | null>, blocks: readonly VBlock[]): number[] {
  const off = new Array<number>(blocks.length + 1);
  off[0] = 0;
  for (let i = 0; i < blocks.length; i++) off[i + 1] = off[i] + heightAt(heights, blocks, i) + blocks[i].gapAfter;
  return off;
}

/**
 * The height of the top spacer: it stands after block 0 (always mounted) and holds the distance
 * to the window's first block, whose own margin-top applies after the spacer. Null when the
 * window starts at block 0 or 1 — then everything between them is mounted and natural flow is
 * already correct.
 */
export function topSpacerHeight(offsets: readonly number[], blocks: readonly VBlock[], heights: ReadonlyArray<number | null>, first: number): number | null {
  if (first <= 1) return null;
  return offsets[first] - blocks[first].marginTop - (offsets[0] + heightAt(heights, blocks, 0) + blocks[0].marginBottom);
}

/**
 * The height of the bottom spacer: it stands after the window's last block (whose margin-bottom
 * escapes towards it, margins being 0 on the spacer) and fills the document down to the total.
 * Null at the very bottom of the doc — there the last margin escapes the article exactly as it
 * does on a plain doc, and the body's height already ends at the content.
 */
export function bottomSpacerHeight(offsets: readonly number[], blocks: readonly VBlock[], heights: ReadonlyArray<number | null>, last: number): number | null {
  if (last >= blocks.length - 1) return null;
  return offsets[blocks.length] - (offsets[last] + heightAt(heights, blocks, last) + blocks[last].marginBottom);
}

/** The largest block index whose top offset is at or above `y` (0 for anything before block 0). */
export function indexAt(offsets: readonly number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type VRange = { first: number; last: number };

/** The block window the viewport needs, padded by `overscan` on both ends. */
export function computeRange(offsets: readonly number[], viewTop: number, viewportH: number, overscan = 8): VRange | null {
  if (offsets.length < 2) return null;
  const first = Math.max(0, indexAt(offsets, Math.max(0, viewTop)) - overscan);
  const last = Math.min(offsets.length - 2, indexAt(offsets, viewTop + viewportH) + overscan);
  return last < first ? null : { first, last };
}

/** The indices to mount: the window's range, or every block when the range is null (small doc,
 *  or a window that covers nothing — both mount everything rather than show a gap). */
export function wantedIndices(count: number, range: VRange | null): number[] {
  if (!range) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let i = Math.max(0, range.first); i <= Math.min(count - 1, range.last); i++) out.push(i);
  return out;
}

/** Big enough to be worth virtualizing: ≥300 blocks, or a body ≥10 viewports tall. */
export function shouldVirtualize(blockCount: number, docHeight: number, viewportH: number): boolean {
  if (viewportH <= 0) return false;
  return blockCount >= 300 || docHeight >= viewportH * 10;
}

/** The indices mounted beyond the window's range: block 0 (it owns the body's `:first-child`
 *  margin rule) and, for a pinned tail — a streamed doc's open exchange — the last block. */
export function pinnedIndices(count: number, pinTail: boolean): number[] {
  const out = [0];
  if (pinTail && count > 1) out.push(count - 1);
  return out;
}

export type VDelta = { i: number; from: number; to: number };

/**
 * The scroll payback for a batch of height changes, in px: a block that grew or shrank above
 * the viewport moved everything the reader sees, so the delta is paid back with scrollBy. A
 * change at or below the viewport top shifts only content below the visible line — no payback.
 * Called with the offsets from before the batch, like the sketch did.
 */
export function anchorAdjust(offsets: readonly number[], viewTop: number, deltas: readonly VDelta[]): number {
  let adjust = 0;
  for (const d of deltas) if (offsets[d.i] < viewTop) adjust += d.to - d.from;
  return adjust;
}

/** Where a block anchor should land: its top minus the top inset (bar + breathing room), ≥0. */
export function landingOffset(offsets: readonly number[], anchor: { i: number; within: number }, topInset: number): number {
  return Math.max(0, offsets[anchor.i] + anchor.within - topInset);
}

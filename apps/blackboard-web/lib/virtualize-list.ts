/**
 * The pure model of the virtualized Contents list. TOC rows are near-uniform height and sit in
 * plain flow (no collapsing margins between them), so the doc body's gap/spacer machinery
 * (`lib/virtualize.ts`) does not apply: a measured-height cache plus one estimate for the rows
 * never mounted is the whole model. `computeRange` / `indexAt` are shared with the body.
 */
import { computeRange, type VRange } from "./virtualize";

/** Rows below this mount every entry, exactly as before virtualization. */
export const LIST_THRESHOLD = 200;

/** A row's height before anything is measured: one line of 13.5px text with `py-1`. */
export const ROW_ESTIMATE = 27;

/** Rows mounted beyond the visible band on each side. */
export const LIST_OVERSCAN = 8;

/** Long enough to be worth windowing. The container's own height only has to exist. */
export function shouldVirtualizeList(count: number, containerHeight: number): boolean {
  return count >= LIST_THRESHOLD && containerHeight > 0;
}

/** Prefix sums of row heights: `offsets[i]` is row i's top, `offsets[n]` the list's total. */
export function rowOffsets(heights: ReadonlyArray<number | null>, estimate = ROW_ESTIMATE): number[] {
  const off = new Array<number>(heights.length + 1);
  off[0] = 0;
  for (let i = 0; i < heights.length; i++) off[i + 1] = off[i] + (heights[i] ?? estimate);
  return off;
}

/** The heights that stand in for the window's unmounted neighbours, in px. */
export function listSpacers(offsets: readonly number[], range: VRange | null): { top: number; bottom: number } {
  const n = offsets.length - 1;
  if (!range || n <= 0) return { top: 0, bottom: 0 };
  const first = Math.max(0, Math.min(n - 1, range.first));
  const last = Math.max(first, Math.min(n - 1, range.last));
  return { top: offsets[first], bottom: Math.max(0, offsets[n] - offsets[last + 1]) };
}

/** The window for a scroll position inside the list's own container. */
export function listRange(offsets: readonly number[], scrollTop: number, viewportH: number, overscan = LIST_OVERSCAN): VRange | null {
  return computeRange(offsets, scrollTop, viewportH, overscan);
}

/**
 * The container's new scrollTop that brings a row fully into view — the numeric twin of
 * `scrollIntoView({ block: "nearest" })`, which cannot be used once the row may be unmounted.
 * A row already fully visible leaves the position alone; a row taller than the viewport aligns
 * to its top, as the browser does.
 */
export function revealScroll(scrollTop: number, viewportH: number, rowTop: number, rowHeight: number): number {
  if (viewportH <= 0) return Math.max(0, scrollTop);
  if (rowTop < scrollTop || rowHeight > viewportH) return Math.max(0, rowTop);
  if (rowTop + rowHeight > scrollTop + viewportH) return Math.max(0, rowTop + rowHeight - viewportH);
  return scrollTop;
}

/**
 * The estimate for rows never mounted: the median of the rows measured so far, so a doc whose
 * rows wrap to two lines (narrow rail) still gets a total height that matches its scrollbar.
 * Null when nothing has been measured yet.
 */
export function medianRowHeight(heights: ReadonlyArray<number | null>): number | null {
  const seen = heights.filter((h): h is number => h != null && h > 0).sort((a, b) => a - b);
  if (seen.length === 0) return null;
  const mid = seen.length >> 1;
  return seen.length % 2 === 1 ? seen[mid] : (seen[mid - 1] + seen[mid]) / 2;
}

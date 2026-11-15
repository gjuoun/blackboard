"use client";

/**
 * Window the Contents list: mount the rows the rail's own scroll container can see (± overscan)
 * and stand the rest on two spacer rows. The list scrolls independently of the document, so the
 * virtualizer binds to that container's scroll events — never the window's — and reveals the
 * active row by moving the container's `scrollTop`, since an unmounted row has no node for
 * `scrollIntoView` to find. The pure math is `lib/virtualize-list.ts`.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { VRange } from "@/lib/virtualize";
import { LIST_OVERSCAN, LIST_THRESHOLD, ROW_ESTIMATE, listRange, listSpacers, medianRowHeight, revealScroll, rowOffsets } from "@/lib/virtualize-list";

/** The viewport guess behind the very first window. It only has to be close — the layout effect
 *  replaces it with the container's real height before paint — and it must be constant so the
 *  server and the hydrating client render the same rows. */
const INITIAL_VIEWPORT = 800;

export type VirtualList = {
  /** False below the threshold: every row renders and no attribute is written. */
  enabled: boolean;
  /** The rows to mount, or null when the whole list is mounted. */
  range: VRange | null;
  /** Height of the spacer standing in for the rows above the window. */
  top: number;
  /** Height of the spacer standing in for the rows below it. */
  bottom: number;
  /** Scroll the list's container so row `index` is mounted and visible. Never moves focus. */
  reveal(index: number): void;
};

type Window = { enabled: boolean; range: VRange | null; top: number; bottom: number };

const ALL: Window = { enabled: false, range: null, top: 0, bottom: 0 };

const sameWindow = (a: Window, b: Window): boolean =>
  a.enabled === b.enabled && a.top === b.top && a.bottom === b.bottom && a.range?.first === b.range?.first && a.range?.last === b.range?.last;

/** The first window, from the count alone: a plain list from the top, or the whole list. */
function firstWindow(count: number): Window {
  if (count < LIST_THRESHOLD) return ALL;
  const offsets = rowOffsets(new Array<number | null>(count).fill(null));
  const range = listRange(offsets, 0, INITIAL_VIEWPORT);
  return { enabled: true, range, ...listSpacers(offsets, range) };
}

/** The nearest ancestor that scrolls vertically: the rail's pane, or the phone's Contents sheet. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

export function useVirtualList({ listRef, count }: { listRef: RefObject<HTMLElement | null>; count: number }): VirtualList {
  const [win, setWin] = useState<Window>(() => firstWindow(count));
  const box = useRef<HTMLElement | null>(null);
  const heights = useRef<(number | null)[]>(new Array<number | null>(count).fill(null));
  const estimate = useRef(ROW_ESTIMATE);
  const offsets = useRef<number[]>(rowOffsets(new Array<number | null>(count).fill(null)));
  const measureRef = useRef<() => void>(() => {});

  const measure = () => {
    const ul = listRef.current;
    const pane = box.current;
    if (!ul || !pane) {
      setWin((w) => (sameWindow(w, ALL) ? w : ALL));
      return;
    }
    if (count < LIST_THRESHOLD) {
      setWin((w) => (sameWindow(w, ALL) ? w : ALL));
      return;
    }
    // A collapsed rail (or a closed sheet) has no geometry to measure against: keep the last
    // window and wait for the width observer to rebuild the cache once it has a size.
    if (pane.clientHeight <= 0 || ul.getBoundingClientRect().width < 1) return;

    const hs = heights.current;
    let changed = false;
    for (const el of ul.querySelectorAll<HTMLElement>("[data-vlist-row]")) {
      const i = Number(el.dataset.vlistRow);
      const h = el.getBoundingClientRect().height;
      if (!Number.isInteger(i) || i < 0 || i >= count || !(h > 0)) continue;
      const old = hs[i];
      if (old != null && Math.abs(old - h) <= 0.5) continue;
      hs[i] = h;
      changed = true;
    }
    // Rows never mounted are estimated from the median measured row: a doc whose entries wrap to
    // two lines still gets a total height that matches the scrollbar.
    const median = medianRowHeight(hs);
    if (median != null && Math.abs(median - estimate.current) > 0.5) {
      estimate.current = median;
      changed = true;
    }
    if (changed) {
      // Rows above the window changed size: pay the shift back so the row under the eye stays put.
      const firstRow = ul.querySelector<HTMLElement>("[data-vlist-row]");
      const first = firstRow ? Number(firstRow.dataset.vlistRow) : 0;
      const prev = offsets.current;
      const next = rowOffsets(hs, estimate.current);
      const shift = (next[first] ?? 0) - (prev[first] ?? 0);
      offsets.current = next;
      if (shift !== 0) pane.scrollTop += shift;
    }
    const viewTop = pane.getBoundingClientRect().top - ul.getBoundingClientRect().top;
    const range = listRange(offsets.current, viewTop, pane.clientHeight, LIST_OVERSCAN);
    const next: Window = { enabled: true, range, ...listSpacers(offsets.current, range) };
    setWin((w) => (sameWindow(w, next) ? w : next));
  };

  // The container, its listeners, and the height cache — rebuilt whenever the count changes.
  useLayoutEffect(() => {
    heights.current = new Array<number | null>(count).fill(null);
    estimate.current = ROW_ESTIMATE;
    offsets.current = rowOffsets(heights.current);
    const ul = listRef.current;
    const pane = ul ? scrollParent(ul) : null;
    box.current = pane;
    if (!ul || !pane) return;
    const onScroll = () => measureRef.current();
    pane.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    // A rail drag, a sheet opening or a window resize re-wraps the rows at a new width, so every
    // cached height is stale: drop them and measure again at the new width.
    let width = ul.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const next = ul.getBoundingClientRect().width;
      if (Math.abs(next - width) < 1) return;
      width = next;
      heights.current = new Array<number | null>(count).fill(null);
      estimate.current = ROW_ESTIMATE;
      offsets.current = rowOffsets(heights.current);
      measureRef.current();
    });
    ro.observe(ul);
    return () => {
      pane.removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      ro.disconnect();
    };
  }, [count, listRef]);

  // Every render may have mounted rows nobody measured yet; the loop settles in one or two passes.
  useLayoutEffect(() => {
    measureRef.current = measure;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a row's height is only knowable after it mounts
    measure();
  });

  const settle = useRef<{ index: number; tick: number; at: number } | null>(null);

  // The row's place in the container's scroll coordinates: its model offset plus the list's own
  // offset (the "Contents" heading and the pane's padding). The mounted element wins when it
  // exists — the model still estimates the rows above a row that was never mounted.
  const rowTopIn = useCallback(
    (index: number, el: HTMLElement | null): { top: number; height: number } => {
      const ul = listRef.current;
      const pane = box.current;
      if (!pane) return { top: 0, height: estimate.current };
      const base = ul ? ul.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop : 0;
      const rect = el?.getBoundingClientRect();
      return rect ? { top: rect.top - pane.getBoundingClientRect().top + pane.scrollTop, height: rect.height } : { top: base + (offsets.current[index] ?? 0), height: heights.current[index] ?? estimate.current };
    },
    [listRef],
  );

  const reveal = useCallback(
    (index: number) => {
      const ul = listRef.current;
      const pane = box.current;
      if (!ul || !pane || count < LIST_THRESHOLD || pane.clientHeight <= 0) return;
      const el = ul.querySelector<HTMLElement>(`[data-vlist-row="${index}"]`);
      const row = rowTopIn(index, el);
      const next = revealScroll(pane.scrollTop, pane.clientHeight, row.top, row.height);
      if (Math.abs(next - pane.scrollTop) > 0.5) pane.scrollTop = next;
      measureRef.current();
      // The row may only have mounted now, and the rows between it and the old window were still
      // estimates: land it, measure, correct — a few frames, exactly like the doc body's jump.
      const target = { index, tick: 0, at: pane.scrollTop };
      settle.current = target;
      const step = () => {
        if (settle.current !== target) return;
        const list = listRef.current;
        const view = box.current;
        if (!list || !view) {
          settle.current = null;
          return;
        }
        // Anything that moved the list without this loop is the reader taking over.
        if (Math.abs(view.scrollTop - target.at) > 4) {
          settle.current = null;
          return;
        }
        const rowEl = list.querySelector<HTMLElement>(`[data-vlist-row="${index}"]`);
        const r = rowTopIn(index, rowEl);
        const wanted = revealScroll(view.scrollTop, view.clientHeight, r.top, r.height);
        if (Math.abs(wanted - view.scrollTop) > 0.5) view.scrollTop = wanted;
        target.at = view.scrollTop;
        measureRef.current();
        target.tick += 1;
        if (target.tick >= 8) {
          settle.current = null;
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [count, listRef, rowTopIn],
  );

  return useMemo<VirtualList>(() => ({ enabled: win.enabled, range: win.range, top: win.top, bottom: win.bottom, reveal }), [win, reveal]);
}

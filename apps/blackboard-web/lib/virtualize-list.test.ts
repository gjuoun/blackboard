import { describe, expect, test } from "bun:test";
import { LIST_OVERSCAN, LIST_THRESHOLD, ROW_ESTIMATE, listRange, listSpacers, medianRowHeight, revealScroll, rowOffsets, shouldVirtualizeList } from "./virtualize-list";

const heights = (n: number, h: number | null): (number | null)[] => new Array<number | null>(n).fill(h);

describe("shouldVirtualizeList", () => {
  test("on at the threshold, off below it", () => {
    expect(shouldVirtualizeList(LIST_THRESHOLD, 800)).toBe(true);
    expect(shouldVirtualizeList(LIST_THRESHOLD - 1, 800)).toBe(false);
    expect(shouldVirtualizeList(1000, 800)).toBe(true);
  });

  test("never with a container that has no height (collapsed rail, closed sheet)", () => {
    expect(shouldVirtualizeList(1000, 0)).toBe(false);
  });
});

describe("rowOffsets", () => {
  test("prefix sums of measured rows, the estimate for the rest", () => {
    const off = rowOffsets([30, null, 20, null], 10);
    expect(off).toEqual([0, 30, 40, 60, 70]);
  });

  test("the default estimate is used when none is given", () => {
    expect(rowOffsets([null, null])).toEqual([0, ROW_ESTIMATE, ROW_ESTIMATE * 2]);
  });

  test("an empty list is a single zero offset", () => {
    expect(rowOffsets([])).toEqual([0]);
  });
});

describe("listSpacers", () => {
  const offsets = rowOffsets([20, 20, 20, 20, 20], 20); // [0,20,40,60,80,100]

  test("a window in the middle stands on a top spacer and ends on a bottom one", () => {
    expect(listSpacers(offsets, { first: 2, last: 3 })).toEqual({ top: 40, bottom: 20 });
  });

  test("a window that starts at the top has no top spacer; one ending last has no bottom", () => {
    expect(listSpacers(offsets, { first: 0, last: 3 }).top).toBe(0);
    expect(listSpacers(offsets, { first: 1, last: 4 }).bottom).toBe(0);
  });

  test("no window (small list) means no spacers, and the spacers always sum to the total", () => {
    expect(listSpacers(offsets, null)).toEqual({ top: 0, bottom: 0 });
    for (let first = 0; first < 5; first++) {
      for (let last = first; last < 5; last++) {
        const s = listSpacers(offsets, { first, last });
        expect(s.top + (offsets[last + 1] - offsets[first]) + s.bottom).toBe(offsets[5]);
      }
    }
  });

  test("a range past the end is clamped instead of reading past the offsets", () => {
    expect(listSpacers(offsets, { first: 4, last: 99 })).toEqual({ top: 80, bottom: 0 });
  });
});

describe("listRange", () => {
  const offsets = rowOffsets(heights(100, 20), 20);

  test("the visible rows plus overscan on both sides", () => {
    // rows 0..49 visible at scrollTop 0 with an 1000px viewport (50 rows), padded by 8.
    expect(listRange(offsets, 0, 1000)).toEqual({ first: 0, last: 58 });
    expect(listRange(offsets, 400, 200)).toEqual({ first: 12, last: 38 });
  });

  test("clamped at the end of the list, and null for a list too short to window", () => {
    expect(listRange(offsets, 1900, 200)).toEqual({ first: 87, last: 99 });
    expect(listRange([0], 0, 200)).toBeNull();
  });

  test("the default overscan is the list's own", () => {
    expect(listRange(offsets, 400, 200)).toEqual(listRange(offsets, 400, 200, LIST_OVERSCAN));
  });
});

describe("revealScroll", () => {
  test("a row already fully visible leaves the scroll alone", () => {
    expect(revealScroll(100, 400, 200, 27)).toBe(100);
    expect(revealScroll(100, 400, 100, 27)).toBe(100);
  });

  test("a row above the viewport is aligned to the top", () => {
    expect(revealScroll(300, 400, 120, 27)).toBe(120);
    expect(revealScroll(300, 400, -40, 27)).toBe(0);
  });

  test("a row below the viewport is aligned to the bottom", () => {
    expect(revealScroll(0, 400, 390, 27)).toBe(17);
  });

  test("a row taller than the viewport aligns to its top, as scrollIntoView does", () => {
    expect(revealScroll(0, 100, 50, 200)).toBe(50);
  });

  test("an unknown viewport (collapsed rail) never scrolls", () => {
    expect(revealScroll(120, 0, 500, 27)).toBe(120);
  });
});

describe("medianRowHeight", () => {
  test("null until something is measured; the median of what is", () => {
    expect(medianRowHeight([null, null])).toBeNull();
    expect(medianRowHeight([null, 27, 0])).toBe(27);
    expect(medianRowHeight([20, 60, 27])).toBe(27);
    // Even counts average the middle pair, so a wrapped row does not drag the estimate.
    expect(medianRowHeight([20, 20, 27, 54])).toBe(23.5);
  });
});

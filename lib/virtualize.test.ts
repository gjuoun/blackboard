import { describe, expect, test } from "bun:test";
import {
  anchorAdjust,
  bottomSpacerHeight,
  computeRange,
  estimateFor,
  heightAt,
  indexAt,
  landingOffset,
  pinnedIndices,
  planChunks,
  rebuildOffsets,
  shouldVirtualize,
  topSpacerHeight,
  wantedIndices,
  type ChunkInput,
} from "./virtualize";

const block = (kind: string, marginTop: number, marginBottom: number, anchors: ChunkInput["anchors"] = []): ChunkInput => ({ kind, marginTop, marginBottom, anchors });

describe("planChunks", () => {
  test("one block per element, gapAfter is the collapsed margin to the next, last gap 0", () => {
    // p(0.6em/0.6em) then h2(1.9em/0.5em) then table(1em/1em): collapsed gaps are max() pairs.
    const plan = planChunks([block("p", 10, 10), block("h2", 30, 8), block("table", 16, 16)]);
    expect(plan.blocks).toHaveLength(3);
    expect(plan.blocks.map((b) => b.gapAfter)).toEqual([Math.max(10, 30), Math.max(8, 16), 0]);
    expect(plan.blocks.map((b) => b.kind)).toEqual(["p", "h2", "table"]);
  });

  test("top-level ids anchor their block; nested headings anchor with their offset inside it", () => {
    const plan = planChunks([
      block("h1", 6, 10, [{ id: "top", within: 0 }]),
      block("p", 10, 10),
      block("blockquote", 16, 16, [{ id: "quoted", within: 24 }]),
    ]);
    expect(plan.anchors.get("top")).toEqual({ i: 0, within: 0 });
    expect(plan.anchors.get("quoted")).toEqual({ i: 2, within: 24 });
    expect(plan.anchors.size).toBe(2);
  });

  test("an empty doc chunks to nothing", () => {
    expect(planChunks([]).blocks).toEqual([]);
    expect(planChunks([]).anchors.size).toBe(0);
  });
});

describe("shouldVirtualize", () => {
  test("on at >=300 blocks even when short, or >=10 viewports even when few blocks", () => {
    expect(shouldVirtualize(300, 1000, 800)).toBe(true);
    expect(shouldVirtualize(50, 8000, 800)).toBe(true);
    expect(shouldVirtualize(8000, 800, 800)).toBe(true);
  });

  test("off below both thresholds, and never with an unknown viewport", () => {
    expect(shouldVirtualize(299, 1000, 800)).toBe(false);
    expect(shouldVirtualize(50, 7999, 800)).toBe(false);
    expect(shouldVirtualize(1000, 100000, 0)).toBe(false);
  });
});

describe("pinned indices", () => {
  test("block 0 is always pinned; the tail only when asked", () => {
    expect(pinnedIndices(10, false)).toEqual([0]);
    expect(pinnedIndices(10, true)).toEqual([0, 9]);
    expect(pinnedIndices(1, true)).toEqual([0]);
  });
});

describe("height cache and offsets", () => {
  test("measured heights win; unmeasured blocks fall back to the kind estimate", () => {
    const plan = planChunks([block("p", 10, 10), block("h2", 10, 10), block("figure", 4, 4)]);
    const heights: (number | null)[] = [30, null, null];
    expect(heightAt(heights, plan.blocks, 0)).toBe(30);
    expect(heightAt(heights, plan.blocks, 1)).toBe(estimateFor("h2"));
    expect(heightAt(heights, plan.blocks, 2)).toBe(estimateFor("figure"));
    // Unknown kinds estimate like a paragraph.
    expect(estimateFor("aside")).toBe(estimateFor("p"));
  });

  test("offsets are prefix sums of height + collapsed gap; a measurement moves everything below", () => {
    const plan = planChunks([block("p", 10, 10), block("p", 20, 10), block("p", 10, 10)]);
    const est = rebuildOffsets([null, null, null], plan.blocks);
    expect(est).toHaveLength(4);
    expect(est[0]).toBe(0);
    // gapAfter(0) = max(mb 10, mt 20) = 20
    expect(est[1]).toBe(heightAt([null, null, null], plan.blocks, 0) + 20);
    expect(est[3]).toBe(est[1] + heightAt([null, null, null], plan.blocks, 1) + 10 + heightAt([null, null, null], plan.blocks, 2));
    const measured = rebuildOffsets([100, null, null], plan.blocks);
    expect(measured[1]).toBe(100 + 20);
    expect(measured[3] - measured[1]).toBe(est[3] - est[1]);
  });

  test("the spacers hold the window's true place; hidden when flow is already contiguous", () => {
    const plan = planChunks([block("h1", 0, 17.76), block("p", 9.6, 9.6), block("p", 9.6, 9.6), block("p", 9.6, 9.6)]);
    const heights: (number | null)[] = [38, null, null, null];
    const offsets = rebuildOffsets(heights, plan.blocks);
    // window at the top: nothing to bridge
    expect(topSpacerHeight(offsets, plan.blocks, heights, 0)).toBeNull();
    expect(topSpacerHeight(offsets, plan.blocks, heights, 1)).toBeNull();
    // window starting at block 2: spacer = block2 top - its mt - (block0 bottom + block0 mb)
    const s = topSpacerHeight(offsets, plan.blocks, heights, 2)!;
    expect(s).toBeCloseTo(offsets[2] - 9.6 - (38 + 17.76), 5);
    // window ending at the last block: the bottom spacer steps aside for the escaping margin
    expect(bottomSpacerHeight(offsets, plan.blocks, heights, 3)).toBeNull();
    expect(bottomSpacerHeight(offsets, plan.blocks, heights, 2)).toBeCloseTo(offsets[4] - (offsets[2] + heightAt(heights, plan.blocks, 2) + 9.6), 5);
  });
});

describe("indexAt and computeRange", () => {
  const offsets = [0, 100, 220, 220, 350]; // block 2 is empty: its top equals the next block's

  test("largest index whose top is at or above y, clamped at both ends", () => {
    expect(indexAt(offsets, -50)).toBe(0);
    expect(indexAt(offsets, 0)).toBe(0);
    expect(indexAt(offsets, 99)).toBe(0);
    expect(indexAt(offsets, 100)).toBe(1);
    expect(indexAt(offsets, 219)).toBe(1);
    expect(indexAt(offsets, 220)).toBe(3); // an empty block's own top belongs to the next real one
    expect(indexAt(offsets, 1e9)).toBe(3);
  });

  test("the window pads the visible range by overscan and clamps to the doc", () => {
    expect(computeRange(offsets, 0, 100, 1)).toEqual({ first: 0, last: 2 });
    expect(computeRange(offsets, 220, 100, 1)).toEqual({ first: 2, last: 3 });
    expect(computeRange([0], 0, 100, 1)).toBeNull();
  });

  test("a null range mounts everything (the small-doc path), a window mounts only its slice", () => {
    expect(wantedIndices(4, null)).toEqual([0, 1, 2, 3]);
    expect(wantedIndices(10, { first: 3, last: 5 })).toEqual([3, 4, 5]);
    expect(wantedIndices(4, { first: 3, last: 9 })).toEqual([3]);
  });
});

describe("anchorAdjust", () => {
  const offsets = [0, 500, 1000, 1500];

  test("a height change above the viewport is paid back in full", () => {
    // Block 0 grew 229px (the sketch's image case): everything visible moved, pay it back.
    expect(anchorAdjust(offsets, 1000, [{ i: 0, from: 500, to: 729 }])).toBe(229);
  });

  test("a change at or below the viewport top needs no compensation", () => {
    expect(anchorAdjust(offsets, 1000, [{ i: 2, from: 500, to: 900 }])).toBe(0);
    expect(anchorAdjust(offsets, 0, [{ i: 0, from: 500, to: 729 }])).toBe(0);
  });

  test("a batch sums its above-viewport deltas only", () => {
    // Blocks 0 and 1 sit above viewTop 1000; block 2 starts exactly at it and never counts.
    expect(anchorAdjust(offsets, 1000, [{ i: 0, from: 500, to: 400 }, { i: 1, from: 500, to: 650 }, { i: 2, from: 500, to: 999 }])).toBe(50);
  });
});

describe("landingOffset", () => {
  test("an anchor lands its top at the inset; never above the body's start", () => {
    expect(landingOffset([0, 500, 1000], { i: 1, within: 0 }, 64)).toBe(436);
    expect(landingOffset([0, 500, 1000], { i: 2, within: 24 }, 64)).toBe(960);
    expect(landingOffset([0, 500, 1000], { i: 0, within: 0 }, 64)).toBe(0);
  });
});

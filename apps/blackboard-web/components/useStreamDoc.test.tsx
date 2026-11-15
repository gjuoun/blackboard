import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchBlocks, groupRanges } from "./useStreamDoc";

describe("groupRanges", () => {
  test("coalesces adjacent pending indices into contiguous ranges", () => {
    expect(groupRanges([3, 4, 5, 9, 10, 20])).toEqual([{ from: 3, to: 5 }, { from: 9, to: 10 }, { from: 20, to: 20 }]);
  });
  test("a full gap batches at most 24 per range", () => {
    const ranges = groupRanges(Array.from({ length: 30 }, (_, i) => i));
    expect(ranges[0]).toEqual({ from: 0, to: 23 });
    expect(ranges[1]).toEqual({ from: 24, to: 29 });
  });
  test("dedupes and sorts", () => {
    expect(groupRanges([5, 3, 5, 4])).toEqual([{ from: 3, to: 5 }]);
  });
});

describe("fetchBlocks", () => {
  // Bun runs test files in one process, so a stubbed fetch outlives this file and breaks any
  // later test that posts for real. Restore the platform fetch after every case.
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("hits /api/stream-blocks with the session and range", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ blocks: [{ id: "b-1", n: 1, html: "<p>x</p>" }], total: 1, epoch: "1:1" }));
    }) as typeof fetch;
    const out = await fetchBlocks("s-abc", 3, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/stream-blocks?id=s-abc&from=3&to=5");
    expect(out).toHaveLength(1);
    expect(out[0].html).toContain("<p>");
  });

  test("a non-ok answer returns nothing rather than throwing", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchBlocks("s-abc", 0, 1)).toEqual([]);
  });
});

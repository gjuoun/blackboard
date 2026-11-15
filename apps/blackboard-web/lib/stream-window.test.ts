import { describe, expect, test } from "bun:test";
import { estimateBlockHeight, parseRange, planStreamWindow } from "./stream-window";

const body = (n: number, extra = "") => `## Exchange ${n}\n\nprose ${"x".repeat(120)}\n\n- a\n- b${extra}`;
const blocks = (n: number, fill = "") => Array.from({ length: n }, (_, i) => ({ body: body(i + 1, fill) }));

describe("estimateBlockHeight", () => {
  test("orders plain text, a code fence and an image", () => {
    const text = estimateBlockHeight("a paragraph\nsecond line");
    const code = estimateBlockHeight("```ts\n" + "x\n".repeat(20) + "```");
    const img = estimateBlockHeight("![shot](x.png)");
    expect(text).toBeLessThan(code);
    expect(img).toBeGreaterThan(text);
    for (const v of [text, code, img]) {
      expect(v).toBeGreaterThanOrEqual(72);
      expect(v).toBeLessThanOrEqual(900);
    }
  });
  test("clamps a huge body at 900", () => {
    expect(estimateBlockHeight("line\n".repeat(5000))).toBe(900);
  });
});

describe("planStreamWindow", () => {
  test("small streams render whole", () => {
    const w = planStreamWindow(blocks(2));
    expect(w.head).toEqual([0, 1]);
    expect(w.tail).toEqual([]);
    expect(w.estimates).toHaveLength(2);
    expect(w.epoch).toBe("2:" + blocks(2).reduce((n, b) => n + b.body.length, 0));
  });

  test("321 blocks: a bounded head plus the tail", () => {
    const w = planStreamWindow(blocks(321), 900);
    expect(w.head.length).toBeGreaterThanOrEqual(8);
    expect(w.head.length).toBeLessThanOrEqual(48);
    expect(w.tail).toEqual([320]);
    expect(w.head).not.toContain(320);
    expect(w.total).toBe(321);
  });

  test("a giant body ends the head after the minimum", () => {
    const giant = Array.from({ length: 200 }, () => ({ body: "y".repeat(50 * 1024) }));
    const w = planStreamWindow(giant, 900);
    expect(w.head.length).toBeLessThanOrEqual(8);
  });

  test("epoch changes with the stream", () => {
    const a = planStreamWindow(blocks(321));
    const b = planStreamWindow(blocks(321, "!"));
    expect(a.epoch).not.toBe(b.epoch);
    expect(planStreamWindow(blocks(4)).epoch).not.toBe(a.epoch);
  });
});

describe("parseRange", () => {
  test("null stays null, single index, both bounds", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("3", 10)).toEqual({ from: 3, to: 3 });
    expect(parseRange("0:9", 10)).toEqual({ from: 0, to: 9 });
  });
  test("clamps to the list and rejects inverted or junk ranges", () => {
    expect(parseRange("8:99", 10)).toEqual({ from: 8, to: 9 });
    expect(parseRange("9:0", 10)).toBe("invalid");
    expect(parseRange("x:y", 10)).toBe("invalid");
    expect(parseRange(":5", 10)).toBe("invalid");
  });
  test("a range past the end clamps to it", () => {
    expect(parseRange("9999", 10)).toEqual({ from: 10, to: 10 });
    expect(parseRange("99:199", 10)).toEqual({ from: 10, to: 10 });
  });
});

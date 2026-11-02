import { describe, expect, test } from "bun:test";
import { exportStream, parseStream, type StreamMeta } from "./stream-doc";
import { renderStream } from "./stream-html";

const line = (o: Record<string, unknown>) => JSON.stringify(o);

const META: StreamMeta = {
  type: "meta",
  v: 1,
  id: "s-01JXXXXXXXXXXXXXXXXXXXXXXX",
  title: "JW-341 三种文档类型 · 时间线收尾",
  kind: "stream",
  created: "2026-11-02T14:03:11.482Z",
  owner: "pi #j7x2",
};
const block = (o: Record<string, unknown>) => ({ type: "block", author: "agent", at: "t", ...o });

describe("stream doc", () => {
  test("stream: the first line is metadata and is never a block", () => {
    const text = [line(META), line(block({ id: "b1", n: 1, action: "answer", body: "a" })), line(block({ id: "b2", n: 2, action: "append", body: "b" }))].join("\n") + "\n";
    const { meta, legacy, blocks, skipped } = parseStream(text);
    expect(meta).toEqual(META);
    expect(legacy).toBe(false);
    expect(blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(skipped).toBe(0);
    expect(blocks.every((b) => b.type === "block")).toBe(true);
    // the metadata object is not in the block list, and a block lacks the meta keys
    expect(JSON.stringify(blocks)).not.toContain('"kind":"stream"');
  });

  test("stream: a file without metadata is legacy and keeps its blocks", () => {
    // Old lines have no `type`: the first one is a block, so there is no metadata line at all.
    const text = [
      line({ id: "b1", n: 1, action: "answer", author: "agent", at: "t1", body: "one" }),
      line({ id: "b2", n: 2, action: "append", author: "agent", at: "t2", body: "two" }),
    ].join("\n");
    const { meta, legacy, blocks, skipped } = parseStream(text);
    expect(meta).toBeNull();
    expect(legacy).toBe(true);
    expect(blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(skipped).toBe(0);
  });

  test("stream: an unusable metadata title is skipped and the blocks still parse", () => {
    const text = [
      line({ ...META, title: 42 }),
      line(block({ id: "b1", n: 1, action: "answer", body: "still here" })),
    ].join("\n");
    const { meta, legacy, blocks, skipped } = parseStream(text);
    expect(meta).toBeNull();
    expect(legacy).toBe(true);
    expect(blocks.map((b) => b.id)).toEqual(["b1"]);
    expect(skipped).toBe(1);
  });

  test("stream: a broken metadata line is skipped and the blocks still parse", () => {
    const text = ["{\"type\":\"meta\",\"title\":", line(block({ id: "b1", n: 1, action: "answer", body: "b" }))].join("\n");
    const { meta, blocks, skipped } = parseStream(text);
    expect(meta).toBeNull();
    expect(blocks).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  test("stream: metadata off the first line is not a block and is not adopted", () => {
    const text = [
      line({ id: "b1", n: 1, action: "answer", author: "agent", at: "t", body: "first" }),
      line(META),
    ].join("\n");
    const { meta, legacy, blocks, skipped } = parseStream(text);
    expect(meta).toBeNull();
    expect(legacy).toBe(true);
    expect(blocks.map((b) => b.id)).toEqual(["b1"]);
    expect(skipped).toBe(1);
  });

  test("stream: blocks parse in file order", () => {
    const text = [
      line({ id: "b3", n: 3, action: "append", author: "agent", at: "t3", body: "c" }),
      line({ id: "b1", n: 1, action: "answer", author: "agent", at: "t1", body: "a" }),
      line({ id: "b2", n: 2, action: "edit", author: "agent", at: "t2", body: "b" }),
    ].join("\n") + "\n";
    const { blocks, skipped } = parseStream(text);
    // file order is the reading order; n is a display number carried on each block, not a sort key
    expect(blocks.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
    expect(blocks.map((b) => b.n)).toEqual([3, 1, 2]);
    expect(skipped).toBe(0);
  });

  test("stream: duplicate id is skipped and counted, not merged", () => {
    const text = [
      line({ id: "b1", n: 1, action: "answer", author: "agent", at: "t", body: "first" }),
      line({ id: "b1", n: 1, action: "answer", author: "agent", at: "t", body: "second" }),
    ].join("\n");
    const { blocks, skipped } = parseStream(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe("first");
    expect(skipped).toBe(1);
  });

  test("stream: unknown action skipped", () => {
    const text = [
      line({ id: "x", n: 1, action: "chat", author: "agent", at: "t", body: "hi" }),
      "not json",
      line({ id: "ok", n: 2, action: "answer", author: "agent", at: "t", body: "ok" }),
    ].join("\n");
    const { blocks, skipped } = parseStream(text);
    expect(blocks.map((b) => b.id)).toEqual(["ok"]);
    expect(skipped).toBe(2);
  });

  test("stream: body has no input", () => {
    // The page renders block bodies from parseStream output only; no input element is ever part of the model.
    const { blocks } = parseStream(line({ id: "a", n: 1, action: "answer", author: "a", at: "t", body: "x" }));
    expect(Object.keys(blocks[0])).not.toContain("input");
  });

  test("stream: header shows action pill and anchor", async () => {
    const { blocks } = parseStream([
      line({ id: "a", n: 1, action: "edit", author: "agent", at: "t", body: "## Changed\n\nText" }),
      line({ id: "b", n: 2, action: "append", author: "agent", at: "t", body: "x", status: "writing" }),
    ].join("\n"));
    const html = await renderStream(blocks);
    // the anchor is the block's own id, never its display number
    expect(html).toContain('id="a"');
    expect(html).not.toContain('id="b1"');
    expect(html).toContain("stream-pill\">改正文<");
    expect(html).toContain("stream-rule-edit");
    expect(html).toContain("stream-rule-append");
    expect(html).toContain("正在写第 2 块");
    expect(html).not.toContain("<input");
  });

  test("stream: export is markdown sections", () => {
    const { blocks } = parseStream(line({ id: "a", n: 1, action: "edit", author: "agent", at: "2026-11-01", body: "changed" }));
    const md = exportStream(blocks, "Stream");
    expect(md.startsWith("# Stream\n")).toBe(true);
    expect(md).toContain("## 1. 改正文 · agent · 2026-11-01");
    expect(md).toContain("changed");
  });
});

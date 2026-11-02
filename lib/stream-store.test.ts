import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBlock, createStream, rewriteBlock, withStreamLock, writeStreamMeta, StreamError } from "./stream-store";
import { parseStream } from "./stream-doc";

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-stream-"));
  const file = join(dir, "s.jsonl");
  writeFileSync(file, "");
  return { dir, file };
};

describe("stream store", () => {
  test("stream: block ids are ULIDs and stay put", () => {
    const { file } = fresh();
    const a = appendBlock(file, { action: "answer", author: "agent", text: "one" });
    const b = appendBlock(file, { action: "append", author: "agent", text: "two" });
    expect(a.id).toMatch(/^b-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b.id).not.toBe(a.id);
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
    // rewriting the body keeps the id, and a renumbering would not change it either
    rewriteBlock(file, a.id, (x) => ({ ...x, body: "one, edited" }));
    const { blocks } = parseStream(readFileSync(file, "utf8"));
    expect(blocks.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(blocks[0].body).toBe("one, edited");
  });

  test("stream: rewrite leaves no temp file and no lock behind", () => {
    const { dir, file } = fresh();
    const a = appendBlock(file, { action: "answer", author: "agent", text: "x" });
    rewriteBlock(file, a.id, (x) => ({ ...x, body: "y" }));
    expect(readdirSync(dir).sort()).toEqual(["s.jsonl"]);
  });

  test("stream: rewrite of an unknown id is refused", () => {
    const { file } = fresh();
    appendBlock(file, { action: "answer", author: "agent", text: "x" });
    expect(() => rewriteBlock(file, "b-missing", (x) => x)).toThrow(StreamError);
  });

  test("stream: a held lock makes a second writer fail, not interleave", () => {
    const { file } = fresh();
    writeFileSync(`${file}.lock`, "other");
    // a fresh lock is never taken over, so the writer gives up after the timeout
    expect(() => withStreamLock(file, () => 1, 200)).toThrow(/locked by another writer/);
    expect(existsSync(`${file}.lock`)).toBe(true);
  });

  test("stream: two writers never interleave lines", async () => {
    const { file } = fresh();
    const writer = `${process.cwd()}/lib/stream-store.ts`;
    // Large bodies and many rounds make the two processes overlap; without the lock, lines interleave.
    // A child that waits past the lock timeout under load retries that one write; any other error still fails.
    const script = `import { appendBlock } from ${JSON.stringify(writer)}; for (let i = 0; i < 300; i++) { for (let tries = 0; ; tries++) { try { appendBlock(${JSON.stringify(file)}, { action: "append", author: "w", text: "x".repeat(4000) + i }); break; } catch (e) { if (!String(e).includes("locked by another writer") || tries > 50) throw e; } } }`;
    const procs = [Bun.spawn(["bun", "-e", script]), Bun.spawn(["bun", "-e", script])];
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual([0, 0]);
    const raw = readFileSync(file, "utf8");
    const { blocks, skipped } = parseStream(raw);
    expect(skipped).toBe(0);
    expect(blocks).toHaveLength(600);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(600);
    // n is computed from the file under the lock; without it two writers read the same last n and collide
    expect(new Set(blocks.map((b) => b.n)).size).toBe(600);
    expect(Math.max(...blocks.map((b) => b.n))).toBe(600);
  }, 60000);

  test("stream: create writes the metadata line and never overwrites", () => {
    const { file } = fresh();
    const first = createStream(file, { title: "标题", owner: "pi #j7x2" }, "2026-11-02T14:03:11.482Z");
    expect(first.created).toBe(true);
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      type: "meta",
      v: 1,
      id: first.meta!.id,
      title: "标题",
      kind: "stream",
      created: "2026-11-02T14:03:11.482Z",
      owner: "pi #j7x2",
    });
    expect(first.meta!.id).toMatch(/^s-[0-9A-HJKMNP-TV-Z]{26}$/);
    // a second create leaves the file as it is and reports the metadata it found
    const second = createStream(file, { title: "另一个标题" });
    expect(second.created).toBe(false);
    expect(second.meta?.title).toBe("标题");
    expect(readFileSync(file, "utf8")).toBe(lines.join("\n"));
  });

  test("stream: append to an empty file writes the metadata line first", () => {
    const { file } = fresh();
    const b = appendBlock(file, { action: "answer", author: "agent", text: "one" }, "2026-11-02T14:05:00.000Z", {
      title: "会话标题",
      owner: "pi #j7x2",
    });
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "meta", v: 1, title: "会话标题", owner: "pi #j7x2" });
    expect(JSON.parse(lines[1])).toMatchObject({ type: "block", id: b.id, n: 1 });
    const parsed = parseStream(readFileSync(file, "utf8"));
    expect(parsed.meta?.title).toBe("会话标题");
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.skipped).toBe(0);
  });

  test("stream: append keeps the first metadata line", () => {
    const { file } = fresh();
    const created = createStream(file, { title: "标题", owner: "pi" }, "2026-11-02T14:03:11.482Z");
    const first = readFileSync(file, "utf8").split("\n")[0];
    appendBlock(file, { action: "answer", author: "agent", text: "one" }, "t1");
    appendBlock(file, { action: "append", author: "agent", text: "two" }, "t2");
    const raw = readFileSync(file, "utf8");
    expect(raw.split("\n")[0]).toBe(first);
    const parsed = parseStream(raw);
    expect(parsed.meta?.id).toBe(created.meta!.id);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.skipped).toBe(0);
  });

  test("stream: rewrite keeps the metadata line and the other blocks byte for byte", () => {
    const { file } = fresh();
    const created = createStream(file, { title: "标题", owner: "pi" }, "2026-11-02T14:03:11.482Z");
    const a = appendBlock(file, { action: "answer", author: "agent", text: "one" }, "t1");
    const b = appendBlock(file, { action: "append", author: "agent", text: "two" }, "t2");
    const before = readFileSync(file, "utf8").split("\n");
    rewriteBlock(file, a.id, (x) => ({ ...x, body: "one, edited" }));
    const after = readFileSync(file, "utf8").split("\n");
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    const parsed = parseStream(after.join("\n"));
    expect(parsed.meta?.id).toBe(created.meta!.id);
    expect(parsed.blocks.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(parsed.blocks.map((x) => x.body)).toEqual(["one, edited", "two"]);
  });

  test("stream: header adds the metadata line to an old file, idempotently", () => {
    const { file } = fresh();
    const old = [
      JSON.stringify({ id: "b1", n: 1, action: "answer", author: "agent", at: "t1", body: "one" }),
      JSON.stringify({ id: "b2", n: 2, action: "append", author: "agent", at: "t2", body: "two" }),
    ].join("\n") + "\n";
    writeFileSync(file, old);
    const first = writeStreamMeta(file, { title: "标题", owner: "pi #j7x2" });
    expect(first.created).toBe(true);
    const afterFirst = readFileSync(file, "utf8");
    // every old block line is exactly where it was, after the new first line
    expect(afterFirst.endsWith(old)).toBe(true);
    const parsed = parseStream(afterFirst);
    expect(parsed.meta).toMatchObject({ type: "meta", v: 1, id: first.meta.id, title: "标题", kind: "stream", owner: "pi #j7x2" });
    expect(parsed.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(parsed.blocks.map((b) => b.body)).toEqual(["one", "two"]);

    const second = writeStreamMeta(file, { title: "标题", owner: "pi #j7x2" });
    expect(second.created).toBe(false);
    expect(second.meta.id).toBe(first.meta.id);
    expect(second.meta.created).toBe(first.meta.created);
    expect(readFileSync(file, "utf8")).toBe(afterFirst);

    // changing the title keeps the document id and creation time, and leaves the owner alone
    const third = writeStreamMeta(file, { title: "新标题" });
    expect(third.meta.id).toBe(first.meta.id);
    expect(third.meta.created).toBe(first.meta.created);
    expect(third.meta.owner).toBe("pi #j7x2");
    expect(parseStream(readFileSync(file, "utf8")).meta?.title).toBe("新标题");
    expect(parseStream(readFileSync(file, "utf8")).blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("stream: create does not touch an old file that already has blocks", () => {
    const { file } = fresh();
    const old = JSON.stringify({ id: "b1", n: 1, action: "answer", author: "agent", at: "t", body: "one" }) + "\n";
    writeFileSync(file, old);
    const r = createStream(file, { title: "标题" });
    expect(r.created).toBe(false);
    expect(r.meta).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(old);
  });

  test("stream: a truncated last line is skipped by readers", () => {
    const { file } = fresh();
    appendBlock(file, { action: "answer", author: "agent", text: "whole" });
    writeFileSync(file, readFileSync(file, "utf8") + "{\"id\":\"b-half"); 
    const { blocks, skipped } = parseStream(readFileSync(file, "utf8"));
    expect(blocks).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

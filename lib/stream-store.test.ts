import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBlock, rewriteBlock, withStreamLock, StreamError } from "./stream-store";
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
    const script = `import { appendBlock } from ${JSON.stringify(writer)}; for (let i = 0; i < 300; i++) appendBlock(${JSON.stringify(file)}, { action: "append", author: "w", text: "x".repeat(4000) + i });`;
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

  test("stream: a truncated last line is skipped by readers", () => {
    const { file } = fresh();
    appendBlock(file, { action: "answer", author: "agent", text: "whole" });
    writeFileSync(file, readFileSync(file, "utf8") + "{\"id\":\"b-half"); 
    const { blocks, skipped } = parseStream(readFileSync(file, "utf8"));
    expect(blocks).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

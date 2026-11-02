import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { run } from "../test/app";
import { parseStream } from "./stream-doc";
import { StreamStore } from "./stream-store";

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "bb-stream-"));
  const file = join(dir, "s.jsonl");
  writeFileSync(file, "");
  return { dir, file };
};

type Api = StreamStore["Service"];

/** A store operation, run the way the CLI runs it. */
const store = <A>(work: (streams: Api) => Effect.Effect<A, { message: string }>) =>
  run(
    Effect.gen(function* () {
      const streams = yield* StreamStore;
      return yield* work(streams);
    }),
  );

const appendBlock = (file: string, input: Parameters<Api["append"]>[1], at?: string, meta?: Parameters<Api["append"]>[3]) =>
  store((s) => s.append(file, input, at, meta));
const rewriteBlock = (file: string, id: string, change: Parameters<Api["rewrite"]>[2]) => store((s) => s.rewrite(file, id, change));
const createStream = (file: string, input: Parameters<Api["create"]>[1], at?: string) => store((s) => s.create(file, input, at));
const writeStreamMeta = (file: string, input: Parameters<Api["writeMeta"]>[1], at?: string) => store((s) => s.writeMeta(file, input, at));

describe("stream store", () => {
  test("stream: block ids are ULIDs and stay put", async () => {
    const { file } = fresh();
    const a = await appendBlock(file, { action: "answer", author: "agent", text: "one" });
    const b = await appendBlock(file, { action: "append", author: "agent", text: "two" });
    expect(a.id).toMatch(/^b-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b.id).not.toBe(a.id);
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
    // rewriting the body keeps the id, and a renumbering would not change it either
    await rewriteBlock(file, a.id, (x) => ({ ...x, body: "one, edited" }));
    const { blocks } = parseStream(readFileSync(file, "utf8"));
    expect(blocks.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(blocks[0].body).toBe("one, edited");
  });

  test("stream: rewrite leaves no temp file and no lock behind", async () => {
    const { dir, file } = fresh();
    const a = await appendBlock(file, { action: "answer", author: "agent", text: "x" });
    await rewriteBlock(file, a.id, (x) => ({ ...x, body: "y" }));
    expect(readdirSync(dir).sort()).toEqual(["s.jsonl"]);
  });

  test("stream: rewrite of an unknown id is refused", async () => {
    const { file } = fresh();
    await appendBlock(file, { action: "answer", author: "agent", text: "x" });
    await expect(rewriteBlock(file, "b-missing", (x) => x)).rejects.toThrow(/no block b-missing/);
  });

  test("stream: a bad action is refused before the lock is taken", async () => {
    const { dir, file } = fresh();
    await expect(appendBlock(file, { action: "nope" as never, author: "agent", text: "x" })).rejects.toThrow(/action takes/);
    expect(readdirSync(dir)).toEqual(["s.jsonl"]);
  });

  test("stream: a held lock makes a second writer fail, not interleave", async () => {
    const { file } = fresh();
    writeFileSync(`${file}.lock`, "other");
    // a fresh lock is never taken over, so the writer gives up after its wait
    await expect(store((s) => s.append(file, { action: "answer", author: "agent", text: "x" }))).rejects.toThrow(/locked by another writer/);
    expect(existsSync(`${file}.lock`)).toBe(true);
  }, 20_000);

  test("stream: two writers never interleave lines", async () => {
    const { file } = fresh();
    const storePath = `${process.cwd()}/lib/stream-store.ts`;
    const runtimePath = `${process.cwd()}/lib/effect/runtime.ts`;
    // Large bodies and many rounds make the two processes overlap; without the lock, lines interleave.
    const script = [
      `import { Effect } from "effect"`,
      `import { StreamStore } from ${JSON.stringify(storePath)}`,
      `import { runtime } from ${JSON.stringify(runtimePath)}`,
      `await runtime.runPromise(Effect.gen(function* () {`,
      `  const streams = yield* StreamStore`,
      `  for (let i = 0; i < 300; i++) {`,
      `    yield* streams.append(${JSON.stringify(file)}, { action: "append", author: "w", text: "x".repeat(4000) + i })`,
      `  }`,
      `}))`,
    ].join("\n");
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
  }, 120_000);

  test("stream: create writes the metadata line and never overwrites", async () => {
    const { file } = fresh();
    const first = await createStream(file, { title: "标题", owner: "pi #j7x2" }, "2026-11-02T14:03:11.482Z");
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
    // a second create leaves the file as it is, the same way a registered file is never rewritten
    const second = await createStream(file, { title: "另一个标题" });
    expect(second.created).toBe(false);
    expect(second.meta?.title).toBe("标题");
    expect(readFileSync(file, "utf8")).toBe(lines.join("\n"));
  });

  test("stream: append to an empty file writes the metadata line first", async () => {
    const { file } = fresh();
    const b = await appendBlock(file, { action: "answer", author: "agent", text: "one" }, "2026-11-02T14:05:00.000Z", {
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

  test("stream: append keeps the first metadata line", async () => {
    const { file } = fresh();
    const created = await createStream(file, { title: "标题", owner: "pi" }, "2026-11-02T14:03:11.482Z");
    const first = readFileSync(file, "utf8").split("\n")[0];
    await appendBlock(file, { action: "answer", author: "agent", text: "one" }, "t1");
    await appendBlock(file, { action: "append", author: "agent", text: "two" }, "t2");
    const raw = readFileSync(file, "utf8");
    expect(raw.split("\n")[0]).toBe(first);
    const parsed = parseStream(raw);
    expect(parsed.meta?.id).toBe(created.meta!.id);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.skipped).toBe(0);
  });

  test("stream: rewrite keeps the metadata line and the other blocks byte for byte", async () => {
    const { file } = fresh();
    const created = await createStream(file, { title: "标题", owner: "pi" }, "2026-11-02T14:03:11.482Z");
    const a = await appendBlock(file, { action: "answer", author: "agent", text: "one" }, "t1");
    const b = await appendBlock(file, { action: "append", author: "agent", text: "two" }, "t2");
    const before = readFileSync(file, "utf8").split("\n");
    await rewriteBlock(file, a.id, (x) => ({ ...x, body: "one, edited" }));
    const after = readFileSync(file, "utf8").split("\n");
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    const parsed = parseStream(after.join("\n"));
    expect(parsed.meta?.id).toBe(created.meta!.id);
    expect(parsed.blocks.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(parsed.blocks.map((x) => x.body)).toEqual(["one, edited", "two"]);
  });

  test("stream: header adds the metadata line to an old file, idempotently", async () => {
    const { file } = fresh();
    const old = [
      JSON.stringify({ id: "b1", n: 1, action: "answer", author: "agent", at: "t1", body: "one" }),
      JSON.stringify({ id: "b2", n: 2, action: "append", author: "agent", at: "t2", body: "two" }),
    ].join("\n") + "\n";
    writeFileSync(file, old);
    const first = await writeStreamMeta(file, { title: "标题", owner: "pi #j7x2" });
    expect(first.created).toBe(true);
    const afterFirst = readFileSync(file, "utf8");
    // every old block line is exactly where it was, after the new first line
    expect(afterFirst.endsWith(old)).toBe(true);
    const parsed = parseStream(afterFirst);
    expect(parsed.meta).toMatchObject({ type: "meta", v: 1, id: first.meta.id, title: "标题", kind: "stream", owner: "pi #j7x2" });
    expect(parsed.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(parsed.blocks.map((b) => b.body)).toEqual(["one", "two"]);

    const second = await writeStreamMeta(file, { title: "标题", owner: "pi #j7x2" });
    expect(second.created).toBe(false);
    expect(second.meta.id).toBe(first.meta.id);
    expect(second.meta.created).toBe(first.meta.created);
    expect(readFileSync(file, "utf8")).toBe(afterFirst);

    // changing the title keeps the document id and creation time, and leaves the owner alone
    const third = await writeStreamMeta(file, { title: "新标题" });
    expect(third.meta.id).toBe(first.meta.id);
    expect(third.meta.created).toBe(first.meta.created);
    expect(third.meta.owner).toBe("pi #j7x2");
    expect(parseStream(readFileSync(file, "utf8")).meta?.title).toBe("新标题");
    expect(parseStream(readFileSync(file, "utf8")).blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("stream: create does not touch an old file that already has blocks", async () => {
    const { file } = fresh();
    const old = JSON.stringify({ id: "b1", n: 1, action: "answer", author: "agent", at: "t", body: "one" }) + "\n";
    writeFileSync(file, old);
    const r = await createStream(file, { title: "标题" });
    expect(r.created).toBe(false);
    expect(r.meta).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(old);
  });

  test("stream: a truncated last line is skipped by readers", async () => {
    const { file } = fresh();
    await appendBlock(file, { action: "answer", author: "agent", text: "whole" });
    writeFileSync(file, readFileSync(file, "utf8") + "{\"id\":\"b-half");
    const { blocks, skipped } = parseStream(readFileSync(file, "utf8"));
    expect(blocks).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
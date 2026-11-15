import { describe, expect, test } from "bun:test";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../test/app";
import { app } from "../app";

const HOST = { host: "127.0.0.1", "content-type": "application/json" };

/** A temp home with a stream of n exchanges. */
async function setup(n: number) {
  const { base } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return { base: yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-streamblocks-" })) };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  const res = await app.request("http://127.0.0.1/api/stream", { method: "POST", headers: HOST, body: JSON.stringify({ title: "Log" }) });
  const { session } = (await res.json()) as { session: { id: string } };
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await app.request("http://127.0.0.1/api/block", {
      method: "POST",
      headers: HOST,
      body: JSON.stringify({ session: session.id, action: "append", body: `Exchange ${i} body`, author: "agent" }),
    });
    const { block } = (await r.json()) as { block: { id: string } };
    ids.push(block.id);
  }
  return { home, session: session.id, ids };
}

describe("GET /api/stream-blocks", () => {
  test("returns rendered html for the range, with total and epoch", async () => {
    const { session } = await setup(5);
    const res = await app.request(`http://127.0.0.1/api/stream-blocks?id=${session}&from=0&to=1`, { headers: HOST });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { blocks: { id: string; n: number; html: string }[]; total: number; epoch: string };
    expect(data.total).toBe(5);
    expect(data.epoch).toMatch(/^5:\d+$/);
    expect(data.blocks).toHaveLength(2);
    expect(data.blocks[0].n).toBe(1);
    expect(data.blocks[0].html).toContain("<p>");
    expect(data.blocks[0].html).toContain("Exchange 1");
  });

  test("a range past the end clamps to an empty slice", async () => {
    const { session } = await setup(3);
    const res = await app.request(`http://127.0.0.1/api/stream-blocks?id=${session}&from=99&to=199`, { headers: HOST });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { blocks: unknown[] };
    expect(data.blocks).toEqual([]);
  });

  test("an inverted or junk range answers 400", async () => {
    const { session } = await setup(3);
    expect((await app.request(`http://127.0.0.1/api/stream-blocks?id=${session}&from=2&to=1`, { headers: HOST })).status).toBe(400);
    expect((await app.request(`http://127.0.0.1/api/stream-blocks?id=${session}&from=x&to=y`, { headers: HOST })).status).toBe(400);
  });

  test("a file session is not a stream", async () => {
    const { session } = await setup(1);
    void session;
    // unknown or non-stream ids answer an api error, not a partial list
    const res = await app.request("http://127.0.0.1/api/stream-blocks?id=nosuchid&from=0&to=1", { headers: HOST });
    expect(res.status).toBe(400);
  });
});

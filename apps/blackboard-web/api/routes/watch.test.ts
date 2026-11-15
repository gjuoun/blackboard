import { describe, expect, test } from "bun:test";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../test/app";
import { open } from "../../lib/cli/sessions";
import { app } from "../app";

const POST = { host: "127.0.0.1", "content-type": "application/json" };

/** A temp Blackboard home and one doc, the same fixture the other api tests build. */
async function setup() {
  const { base, design } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-watch-" }));
      const docs = join(base, "docs");
      yield* fs.makeDirectory(docs, { recursive: true });
      const design = join(docs, "design.md");
      yield* fs.writeFileString(design, "# Design\n\nLater text.\n");
      return { base, design };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  const { session } = await run(open(home, design));
  return { home, design, session: session.id };
}

const HOST = { host: "127.0.0.1" };

describe("GET /api/watch", () => {
  test("an unknown session is refused", async () => {
    // The temp home must be set before the first request: the API reads BLACKBOARD_HOME per call.
    await setup();
    const res = await app.request("http://127.0.0.1/api/watch?session=nosuchid", { headers: HOST });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("unknown session");
  });

  test("a comment mutation on the api emits a changed frame", async () => {
    const { session } = await setup();
    const ac = new AbortController();
    const res = await app.request(`http://127.0.0.1/api/watch?session=${session}`, { signal: ac.signal, headers: HOST });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const first = await reader.read();
    expect(dec.decode(first.value)).toBe(": connected\n\n");

    const post = await app.request("http://127.0.0.1/api/comments", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({ session, general: true, body: "watched", author: "jun" }),
    });
    expect(post.status).toBe(201);

    const frame = await Promise.race([reader.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no frame in 2s")), 2000))]);
    expect(dec.decode(frame.value)).toContain("event: changed");
    expect(dec.decode(frame.value)).toContain('data: {"doc":false,"comments":true}');
    ac.abort();
  }, 10_000);

  test("a streamed doc answers the doc mark from the bus, without watching a folder", async () => {
    await setup();
    const created = await app.request("http://127.0.0.1/api/stream", { method: "POST", headers: POST, body: JSON.stringify({ title: "Log" }) });
    const { session } = (await created.json()) as { session: { id: string } };
    const ac = new AbortController();
    const res = await app.request(`http://127.0.0.1/api/watch?session=${session.id}`, { signal: ac.signal, headers: HOST });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    expect(dec.decode((await reader.read()).value)).toBe(": connected\n\n");

    const post = await app.request("http://127.0.0.1/api/block", {
      method: "POST", headers: POST,
      body: JSON.stringify({ session: session.id, action: "answer", body: "live", author: "agent" }),
    });
    expect(post.status).toBe(201);

    const frame = await Promise.race([reader.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no frame in 2s")), 2000))]);
    expect(dec.decode(frame.value)).toContain("event: changed");
    expect(dec.decode(frame.value)).toContain('data: {"doc":true');
    ac.abort();
  }, 10_000);
});

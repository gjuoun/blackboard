import { describe, expect, test } from "bun:test";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../test/app";
import { SessionsStore } from "../../lib/sessions";
import { app } from "../app";

const HOST = { host: "127.0.0.1", "content-type": "application/json" };

/** A temp home with one streamed document. */
async function setup() {
  const { base } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const b = yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-streams-" }));
      return { base: b };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  const res = await app.request("http://127.0.0.1/api/stream", { method: "POST", headers: HOST, body: JSON.stringify({ title: "Log" }) });
  const { session } = (await res.json()) as { session: { id: string; kind: string } };
  return { home, session };
}

describe("POST /api/stream", () => {
  test("creates a path-less stream session the api can then serve", async () => {
    const { session } = await setup();
    expect(session.id).toMatch(/^s-/);
    expect(session.kind).toBe("stream");
    const got = await app.request(`http://127.0.0.1/api/session?id=${session.id}`, { headers: HOST });
    expect(got.status).toBe(200);
  });

  test("a missing title is refused", async () => {
    await setup();
    const res = await app.request("http://127.0.0.1/api/stream", { method: "POST", headers: HOST, body: "{}" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("title is required");
  });
});

describe("POST /api/block", () => {
  test("append and in-place edit land, and documents.body refolds", async () => {
    const { session } = await setup();
    const post = (body: object) =>
      app.request("http://127.0.0.1/api/block", { method: "POST", headers: HOST, body: JSON.stringify(body) });
    const first = await (await post({ session: session.id, action: "answer", body: "# Hi", author: "agent" })).json();
    expect(first.block.n).toBe(1);
    await post({ session: session.id, action: "append", body: "more", author: "jun", status: "writing" });
    const edited = await (await post({ session: session.id, edit: first.block.id, body: "# Hi again", author: "agent" })).json();
    expect(edited.block.n).toBe(1);
    expect(edited.block.body).toBe("# Hi again");
    const got = await (await app.request(`http://127.0.0.1/api/session?id=${session.id}`, { headers: HOST })).json();
    expect(got.body).toBe("# Hi again\n\nmore\n");
  });

  test("an unknown session is refused", async () => {
    await setup();
    const post = (body: object) =>
      app.request("http://127.0.0.1/api/block", { method: "POST", headers: HOST, body: JSON.stringify(body) });
    expect((await post({ session: "nosuch", action: "answer", body: "x", author: "a" })).status).toBe(400);
    expect((await (await post({ session: "nosuch", action: "answer", body: "x", author: "a" })).json()).error).toBe("unknown session");
  });

  test("a file session reports it is not a stream", async () => {
    const { home } = await setup();
    const file = await run(Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const f = join(home, "doc.md");
      yield* fs.writeFileString(f, "# Doc\n");
      const store = yield* SessionsStore;
      return yield* store.open(home, f);
    }));
    const res = await app.request("http://127.0.0.1/api/block", {
      method: "POST", headers: HOST,
      body: JSON.stringify({ session: file.id, action: "answer", body: "x", author: "a" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("is not a stream");
  });
});

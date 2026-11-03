import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { NextRequest } from "next/server";
import { run } from "../../../test/app";
import { POST as bindPost } from "@/app/api/bind/route";
import { open } from "@/lib/cli/sessions";
import { GET, PATCH, POST } from "./route";

/** A temp Blackboard home and one doc, plus a listener standing in for the pi extension. */
async function setup() {
  const { base, design } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-notify-" }));
      const docs = join(base, "docs");
      yield* fs.makeDirectory(docs, { recursive: true });
      const design = join(docs, "design.md");
      yield* fs.writeFileString(design, "# Design\n\nLater text. More text.\n");
      return { base, design };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  const { session } = await run(open(home, design));
  return { home, design, session: session.id };
}

type Payload = { kind: string; session: string; doc: string; commentId: string; anchor: Record<string, unknown>; body: string; author: string; at: string; pageUrl: string };

function listener() {
  const received: Payload[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      received.push((await req.json()) as Payload);
      return Response.json({ ok: true });
    },
  });
  return { server, received, url: `http://127.0.0.1:${server.port}` };
}

let open_servers: { stop: (force?: boolean) => void }[] = [];
const start = () => {
  const made = listener();
  open_servers.push(made.server);
  return made;
};
afterEach(() => {
  for (const server of open_servers) server.stop(true);
  open_servers = [];
});

/** The notify is fire-and-forget, so wait for the listener rather than for the response. */
async function until(received: Payload[], count: number): Promise<Payload[]> {
  for (let i = 0; i < 100 && received.length < count; i += 1) await Bun.sleep(10);
  return received;
}

const json = (payload: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const comment = (session: string) => POST(new NextRequest("http://127.0.0.1:38770/api/comments", json({ session, general: true, body: "**first** note", author: "jun" })));
const reply = (session: string, id: string) =>
  PATCH(new NextRequest("http://127.0.0.1:38770/api/comments", json({ session, id, action: "reply", body: "answered", author: "agent" }, "PATCH")));
const bind = (session: string, url: string) => bindPost(new NextRequest("http://127.0.0.1/api/bind", json({ session, piSession: "pi-abc123", url })));

describe("a submitted comment reaches the bound listener", () => {
  test("one comment is one payload, with every field the extension reads", async () => {
    const { session } = await setup();
    const fake = start();
    expect((await bind(session, fake.url)).status).toBe(200);

    const res = await comment(session);
    expect(res.status).toBe(201);
    const { comment: stored } = await res.json();
    const [payload] = await until(fake.received, 1);
    expect(fake.received).toHaveLength(1);
    expect(payload.session).toBe(session);
    expect(payload.doc).toBe("design.md");
    expect(payload.commentId).toBe(stored.id);
    expect(payload.anchor).toEqual({ general: true });
    expect(payload.body).toBe("**first** note");
    expect(payload.author).toBe("jun");
    // The page link is this request's origin: 127.0.0.1 when the browser used it, localhost when not.
    expect(payload.pageUrl).toMatch(new RegExp(`^http://(127\\.0\\.0\\.1|localhost):38770/s/${session}$`));
    expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a reply is one payload naming the thread it joined", async () => {
    const { session } = await setup();
    const fake = start();
    await bind(session, fake.url);
    const { comment: stored } = await (await POST(new NextRequest("http://127.0.0.1:38770/api/comments", json({ session, general: true, body: "q", author: "jun" })))).json();
    await until(fake.received, 1);
    await reply(session, stored.id);
    const [payload] = await until(fake.received, 2);
    expect(fake.received).toHaveLength(2);
    expect(fake.received[1].commentId).toBe(stored.id);
    expect(fake.received[1].body).toBe("answered");
    expect(fake.received[1].author).toBe("agent");
    expect(payload.commentId).toBe(stored.id);
  });
});

describe("an unbound or unreachable session changes nothing", () => {
  test("no binding: the comment is stored and nothing is sent", async () => {
    const { session } = await setup();
    const fake = start();
    const res = await comment(session);
    expect(res.status).toBe(201);
    await Bun.sleep(100);
    expect(fake.received).toHaveLength(0);
    const list = await (await GET(new NextRequest("http://127.0.0.1:38770/api/comments?session=" + session))).json();
    expect(list.comments).toHaveLength(1);
  });

  test("a bound url that refuses connections: same 201, same body", async () => {
    const { session } = await setup();
    const fake = start();
    const url = fake.url;
    fake.server.stop(true);
    expect((await bind(session, url)).status).toBe(200);
    const res = await comment(session);
    expect(res.status).toBe(201);
    const { comment: stored } = await res.json();
    expect(stored.body).toBe("**first** note");
    expect(stored.html).toContain("<strong>first</strong>");
  });
});

describe("the submit path pays nothing for the bridge", () => {
  test("with no binding, 20 submits add under 5 ms in the median", async () => {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const { session } = await setup();
    const fake = start();
    const time = async () => {
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const began = performance.now();
        expect((await comment(session)).status).toBe(201);
        samples.push(performance.now() - began);
      }
      return median(samples);
    };
    const unbound = await time();
    await bind(session, fake.url);
    const bound = await time();
    expect(bound - unbound).toBeLessThan(5);
  });
});

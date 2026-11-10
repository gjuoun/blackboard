import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LOCAL, fixture, register } from "../../test/api-fixture";
import { app } from "../app";

/**
 * The notify bridge, driven through the API app. A submit posts one payload to the listener bound to
 * the session; a reply, an edit or a resolve posts nothing. An unbound session, or a listener that
 * refuses connections, changes nothing the submitter sees: same 201, same body.
 */

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

let servers: { stop: (force?: boolean) => void }[] = [];
const start = () => {
  const made = listener();
  servers.push(made.server);
  return made;
};
afterEach(() => {
  for (const server of servers) server.stop(true);
  servers = [];
});

/** The notify is fire-and-forget, so wait for the listener rather than for the response. */
async function until(received: Payload[], count: number): Promise<Payload[]> {
  for (let i = 0; i < 100 && received.length < count; i += 1) await Bun.sleep(10);
  return received;
}

const json = (payload: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { ...LOCAL, "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const comment = (session: string) => app.request("http://127.0.0.1/api/comments", json({ session, general: true, body: "**first** note", author: "jun" }));
const reply = (session: string, id: string) => app.request("http://127.0.0.1/api/comments", json({ session, id, action: "reply", body: "answered", author: "agent" }, "PATCH"));
const edit = (session: string, id: string, body: string) => app.request("http://127.0.0.1/api/comments", json({ session, id, action: "edit", body }, "PATCH"));
const resolve = (session: string, id: string) => app.request("http://127.0.0.1/api/comments", json({ session, id, action: "resolve", author: "jun" }, "PATCH"));
const bind = (session: string, url: string) => app.request("http://127.0.0.1/api/bind", json({ session, piSession: "pi-abc123", url }));

async function setup() {
  const { home, docs } = await fixture("bb-notify-", { "design.md": "# Design\n\nLater text. More text.\n" });
  const session = await register(home, join(docs, "design.md"));
  return { home, session: session.id };
}

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
    // The page link is the origin the request came in on: the API has no UI origin of its own, so the
    // test sends the origin the forwarder would send, and checks the link names it.
    expect(payload.pageUrl).toBe(`http://127.0.0.1/s/${session}`);
    expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a forwarded host names the UI origin in the page link", async () => {
    const { session } = await setup();
    const fake = start();
    await bind(session, fake.url);
    await app.request("http://127.0.0.1/api/comments", { ...json({ session, general: true, body: "via ui", author: "jun" }), headers: { ...LOCAL, "content-type": "application/json", "x-forwarded-host": "127.0.0.1:38770" } });
    const [payload] = await until(fake.received, 1);
    expect(payload.pageUrl).toBe(`http://127.0.0.1:38770/s/${session}`);
  });
});

describe("only a submit wakes the session", () => {
  test("a reply, an edit and a resolve are stored and send nothing", async () => {
    const { session } = await setup();
    const fake = start();
    expect((await bind(session, fake.url)).status).toBe(200);
    const { comment: stored } = await (await comment(session)).json();
    const [submitted] = await until(fake.received, 1);
    expect(submitted.commentId).toBe(stored.id);

    expect((await reply(session, stored.id)).status).toBe(200);
    expect((await edit(session, stored.id, "rewritten body")).status).toBe(200);
    expect((await resolve(session, stored.id)).status).toBe(200);
    await Bun.sleep(200);
    expect(fake.received).toHaveLength(1);

    const list = await (await app.request(`http://127.0.0.1/api/comments?session=${session}`, { headers: LOCAL })).json();
    expect(list.comments).toHaveLength(1);
    expect(list.comments[0].replies).toHaveLength(1);
    expect(list.comments[0].replies[0].body).toBe("answered");
    expect(list.comments[0].body).toBe("rewritten body");
    expect(list.comments[0].status).toBe("resolved");
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
    const list = await (await app.request(`http://127.0.0.1/api/comments?session=${session}`, { headers: LOCAL })).json();
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
  test("with a binding, 20 submits add under 5 ms in the median", async () => {
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

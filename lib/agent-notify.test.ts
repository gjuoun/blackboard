import { afterEach, describe, expect, test } from "bun:test";
import { notifyAgent, payloadFor, postPayload, type AgentPayload } from "./agent-notify";
import type { Binding } from "./agents-store";
import type { Comment } from "./comments-store";

/** A listener that records what it is posted, standing in for the pi extension. */
function listener(handler?: (payload: AgentPayload) => Promise<Response> | Response) {
  const received: AgentPayload[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const payload = (await req.json()) as AgentPayload;
      received.push(payload);
      return handler ? handler(payload) : Response.json({ ok: true });
    },
  });
  return { server, received, url: `http://127.0.0.1:${server.port}` };
}

let open: { stop: (force?: boolean) => void }[] = [];
const start = (handler?: (payload: AgentPayload) => Promise<Response> | Response) => {
  const made = listener(handler);
  open.push(made.server);
  return made;
};
afterEach(() => {
  for (const server of open) server.stop(true);
  open = [];
});

const comment = (extra: Partial<Comment> = {}): Comment => ({
  id: "c_0123456789ab",
  general: true,
  body: "the comment body",
  author: "jun",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "open",
  replies: [],
  ...extra,
});

const binding = (url: string): Binding => ({
  session: "abc123",
  path: "/tmp/design.md",
  piSession: "pi-abc123",
  url,
  boundAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
});

describe("payloadFor", () => {
  test("a general comment carries the general anchor and the text as given", () => {
    const payload = payloadFor({
      session: "abc123",
      doc: "design.md",
      comment: comment(),
      body: "the comment body",
      author: "jun",
      pageUrl: "http://127.0.0.1:38770/s/abc123",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(payload).toEqual({
      kind: "comment",
      session: "abc123",
      doc: "design.md",
      commentId: "c_0123456789ab",
      anchor: { general: true },
      body: "the comment body",
      author: "jun",
      at: "2026-01-01T00:00:00.000Z",
      pageUrl: "http://127.0.0.1:38770/s/abc123",
    });
  });

  test("a quoted comment carries its selector, and the body and author given", () => {
    const payload = payloadFor({
      session: "abc123",
      doc: "design.md",
      comment: comment({ general: undefined, quote: { exact: "Later text.", prefix: "", suffix: "" } }),
      body: "the body as given",
      author: "agent",
      pageUrl: "http://127.0.0.1:38770/s/abc123",
    });
    expect(payload.anchor).toEqual({ quote: { exact: "Later text.", prefix: "", suffix: "" } });
    expect(payload.body).toBe("the body as given");
    expect(payload.author).toBe("agent");
    expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("postPayload", () => {
  test("one POST carries exactly the payload", async () => {
    const fake = start();
    const payload = payloadFor({
      session: "abc123",
      doc: "design.md",
      comment: comment(),
      body: "the comment body",
      author: "jun",
      pageUrl: "http://127.0.0.1:38770/s/abc123",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(await postPayload(fake.url, payload)).toBe(true);
    expect(fake.received).toEqual([payload]);
  });

  test("a port that refuses the connection answers false", async () => {
    const fake = start();
    const url = fake.url;
    fake.server.stop(true);
    expect(await postPayload(url, payloadFor({ session: "a", doc: "d.md", comment: comment(), body: "b", author: "jun", pageUrl: "u" }))).toBe(false);
  });

  test("a listener that never answers is abandoned at the 500 ms budget", async () => {
    const fake = start(() => new Promise<Response>(() => {}));
    const began = performance.now();
    expect(await postPayload(fake.url, payloadFor({ session: "a", doc: "d.md", comment: comment(), body: "b", author: "jun", pageUrl: "u" }))).toBe(false);
    const took = performance.now() - began;
    expect(took).toBeGreaterThanOrEqual(450);
    expect(took).toBeLessThan(1500);
  });
});

describe("notifyAgent", () => {
  test("no binding is a no-op", async () => {
    const fake = start();
    notifyAgent(null, payloadFor({ session: "abc123", doc: "d.md", comment: comment(), body: "b", author: "jun", pageUrl: "u" }));
    await Bun.sleep(50);
    expect(fake.received).toHaveLength(0);
  });

  test("a binding hands the payload over without the caller waiting", async () => {
    const fake = start();
    const payload = payloadFor({ session: "abc123", doc: "d.md", comment: comment(), body: "b", author: "jun", pageUrl: "u" });
    const began = performance.now();
    notifyAgent(binding(fake.url), payload);
    expect(performance.now() - began).toBeLessThan(5);
    await Bun.sleep(50);
    expect(fake.received).toEqual([payload]);
  });
});

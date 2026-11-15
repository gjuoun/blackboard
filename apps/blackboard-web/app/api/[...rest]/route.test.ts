import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GET } from "./route";

/** The route context Next hands the handler. */
const ctx = (rest: string[]) => ({ params: Promise.resolve({ rest }) });

let servers: { stop: (force?: boolean) => void }[] = [];
let saved: string | undefined;

/** A stand-in API on a port of its own; the forwarder reaches it through BLACKBOARD_API_URL. */
function upstream(handler: (req: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  saved = process.env.BLACKBOARD_API_URL;
});

afterEach(() => {
  for (const server of servers) server.stop(true);
  servers = [];
  if (saved === undefined) delete process.env.BLACKBOARD_API_URL;
  else process.env.BLACKBOARD_API_URL = saved;
});

describe("the /api forwarder", () => {
  test("a request the browser cancelled is not reported as an API that is down", async () => {
    // The upstream never answers, so only the abort can settle the request.
    process.env.BLACKBOARD_API_URL = upstream(() => new Promise<Response>(() => {}));
    const ac = new AbortController();
    const req = new Request("http://127.0.0.1/api/watch?session=x", { signal: ac.signal });
    ac.abort();

    const res = await GET(req, ctx(["watch"]));
    // 499, not the 503 the UI shows for an API that is not running — and nothing to pipe.
    expect(res.status).toBe(499);
    expect(await res.text()).toBe("");
  });

  test("an API that is not running still answers the 503 the UI shows", async () => {
    const url = upstream(() => new Response("ok"));
    // A port that listened a moment ago and is now closed: nothing is there to answer.
    for (const server of servers.splice(0)) server.stop(true);
    process.env.BLACKBOARD_API_URL = url;

    const res = await GET(new Request("http://127.0.0.1/api/health"), ctx(["health"]));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "the API is not running — start it with: blackboard serve start" });
  });

  test("a streamed body ends when the browser leaves instead of failing the pipe", async () => {
    const frame = new TextEncoder().encode(": connected\n\n");
    // One frame, then the connection is held open — the shape of the watch stream.
    process.env.BLACKBOARD_API_URL = upstream(() =>
      new Response(new ReadableStream({ start: (controller) => controller.enqueue(frame) }), { headers: { "content-type": "text/event-stream" } }),
    );
    const ac = new AbortController();
    const res = await GET(new Request("http://127.0.0.1/api/watch?session=x", { signal: ac.signal }), ctx(["watch"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": connected\n\n");
    const pending = reader.read();
    ac.abort();
    // The read resolves as the end of the body; a rejection here is what Next logs as a failed pipe.
    expect((await pending).done).toBe(true);
  });
});
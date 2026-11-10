import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LOCAL, fixture, register } from "../../test/api-fixture";
import { app } from "../app";

/**
 * The bind route, driven through the API app. Behaviour matches the Next route tests it replaces:
 * the same refusals and messages, the same record, the same replace-on-rebind. The record is read
 * back through GET, because the bindings live in the agents table rather than a JSON file.
 */

const json = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { ...LOCAL, "content-type": "application/json" },
  body: typeof payload === "string" ? payload : JSON.stringify(payload),
});
const bind = (payload: unknown) => app.request("http://127.0.0.1/api/bind", json(payload));
const get = (session: string) => app.request(`http://127.0.0.1/api/bind?session=${session}`, { headers: LOCAL });
const remove = (session: string) => app.request(`http://127.0.0.1/api/bind?session=${session}`, { method: "DELETE", headers: LOCAL });

async function setup() {
  const { base, home, docs } = await fixture("bb-bind-", { "design.md": "# Design\n\nLater text.\n" });
  const session = await register(home, join(docs, "design.md"));
  return { base, home, design: join(docs, "design.md"), session: session.id };
}

describe("POST /api/bind", () => {
  test("an unknown session is refused with a plain message", async () => {
    await setup();
    const res = await bind({ session: "nosuchid", piSession: "pi-1", url: "http://127.0.0.1:40000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });

  test("a body that is not JSON is the same refusal", async () => {
    await setup();
    expect((await bind("{not json")).status).toBe(400);
  });

  test("a missing piSession is refused by name", async () => {
    const { session } = await setup();
    const res = await bind({ session, url: "http://127.0.0.1:40000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "piSession is required" });
  });

  test("only a loopback http url is accepted", async () => {
    const { session } = await setup();
    for (const url of ["http://10.1.2.3:5000", "https://127.0.0.1:5000", "http://example.com:5000", "not a url", ""]) {
      const res = await bind({ session, piSession: "pi-1", url });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "url must be a loopback http url" });
    }
  });

  test("a bind stores the record, and binding again replaces it", async () => {
    const { design, session } = await setup();
    const res = await bind({ session, piSession: "pi-1", url: "http://127.0.0.1:40000/" });
    expect(res.status).toBe(200);
    const { binding } = await res.json();
    expect(binding.session).toBe(session);
    expect(binding.path).toBe(design);
    expect(binding.piSession).toBe("pi-1");
    expect(binding.url).toBe("http://127.0.0.1:40000");

    // The record the route stored, read back through the same API.
    expect((await (await get(session)).json()).binding).toMatchObject({ session, piSession: "pi-1", url: "http://127.0.0.1:40000" });

    await bind({ session, piSession: "pi-2", url: "http://localhost:40001" });
    expect((await get(session)).status).toBe(200);
    const again = (await (await get(session)).json()).binding;
    expect(again.piSession).toBe("pi-2");
    expect(again.url).toBe("http://localhost:40001");
  });
});

describe("GET and DELETE /api/bind", () => {
  test("a session without a binding answers null, and an unknown session is a 400", async () => {
    const { session } = await setup();
    const res = await get(session);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ binding: null });
    expect((await get("nosuchid")).status).toBe(400);
  });

  test("unbind answers the id once, then null", async () => {
    const { session } = await setup();
    await bind({ session, piSession: "pi-1", url: "http://127.0.0.1:40000" });
    const first = await remove(session);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ unbound: session });
    expect(await (await remove(session)).json()).toEqual({ unbound: null });
    expect(await (await get(session)).json()).toEqual({ binding: null });
  });
});

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { guard } from "./guard";

const app = new Hono();
app.use("*", guard);
app.get("/api/ok", (c) => c.json({ ok: true }));
app.post("/api/ok", (c) => c.json({ ok: true }));

describe("the api guard keeps proxy.ts semantics", () => {
  test("a non-local Host is refused, even on GET", async () => {
    const res = await app.request("/api/ok", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden: Blackboard only answers localhost");
  });

  test("a loopback Host passes", async () => {
    const res = await app.request("/api/ok", { headers: { host: "localhost:38771" } });
    expect(res.status).toBe(200);
  });

  test("a cross-site Origin on a write is refused", async () => {
    const res = await app.request("/api/ok", {
      method: "POST",
      headers: { host: "127.0.0.1:38771", origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden: cross-site write");
  });

  test("a local Origin on a write passes; no Origin on a write passes", async () => {
    const local = await app.request("/api/ok", { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1:38770" } });
    expect(local.status).toBe(200);
    const bare = await app.request("/api/ok", { method: "POST", headers: { host: "127.0.0.1" } });
    expect(bare.status).toBe(200);
  });

  test("a cross-site GET is Host-guarded but Origin-ignored", async () => {
    const res = await app.request("/api/ok", { headers: { host: "127.0.0.1", origin: "http://evil.example" } });
    expect(res.status).toBe(200);
  });
});

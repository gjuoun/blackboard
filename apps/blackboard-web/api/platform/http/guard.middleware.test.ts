import { describe, expect, test } from "bun:test";
import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { json } from "./envelope";
import { guard } from "./guard.middleware";
import { HttpFailure, INTERNAL_ERROR } from "./http.failure";

const app = new Hono();
app.onError((err, _c) =>
  err instanceof HTTPException ? err.getResponse() : new HttpFailure(INTERNAL_ERROR).getResponse(),
);
app.use("*", guard);
app.get("/api/ok", (c) => json(c, Safe.ok({ ok: true })));
app.post("/api/ok", (c) => json(c, Safe.ok({ ok: true })));

describe("the guard keeps proxy.ts semantics, answered in the envelope", () => {
  test("a non-local Host is refused, even on GET", async () => {
    const res = await app.request("/api/ok", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "FORBIDDEN_HOST", message: "Forbidden: Blackboard only answers localhost" },
    });
  });

  test("a loopback Host passes", async () => {
    const res = await app.request("/api/ok", { headers: { host: "localhost:38771" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { ok: true } });
  });

  test("a cross-site Origin on a write is refused", async () => {
    const res = await app.request("/api/ok", {
      method: "POST",
      headers: { host: "127.0.0.1:38771", origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "FORBIDDEN_CROSS_SITE", message: "Forbidden: cross-site write" },
    });
  });

  test("a local Origin on a write passes; no Origin on a write passes", async () => {
    const local = await app.request("/api/ok", {
      method: "POST",
      headers: { host: "127.0.0.1", origin: "http://127.0.0.1:38770" },
    });
    expect(local.status).toBe(200);
    const bare = await app.request("/api/ok", { method: "POST", headers: { host: "127.0.0.1" } });
    expect(bare.status).toBe(200);
  });

  test("a cross-site GET is Host-guarded but Origin-ignored", async () => {
    const res = await app.request("/api/ok", {
      headers: { host: "127.0.0.1", origin: "http://evil.example" },
    });
    expect(res.status).toBe(200);
  });

  test("an allowed extra host from the env passes", async () => {
    process.env.BLACKBOARD_ALLOWED_HOSTS = "";
    expect((await app.request("/api/ok", { headers: { host: "blackboard.qqntt.com" } })).status).toBe(200);
  });
});

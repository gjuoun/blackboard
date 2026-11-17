import { describe, expect, test } from "bun:test";
import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { json } from "./envelope";
import { errorEnvelope, HttpFailure, INTERNAL_ERROR } from "./http.failure";

const NoteError = {
  NOTE_NOT_FOUND: { status: 404 as const, message: "no such note" },
  QUERY_FAILED: { status: 500 as const, message: "query failed" },
} as const;

type NoteFailure =
  | { NOTE_NOT_FOUND: { status: 404; message: string; id: string } }
  | { QUERY_FAILED: { status: 500; message: string; cause: string } };

const notFound: NoteFailure = { NOTE_NOT_FOUND: { status: 404, message: "no such note", id: "n1" } };
const queryFailed: NoteFailure = {
  QUERY_FAILED: { status: 500, message: "query failed", cause: "SQLITE_BUSY at select" },
};

/** The app the real API is: onError is the only converter of a thrown failure into a response. */
function appOn() {
  const app = new Hono();
  app.onError((err, _c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return new HttpFailure(INTERNAL_ERROR).getResponse();
  });
  return app;
}

describe("json(c, safe)", () => {
  test("the success arm answers 200 with {success:true,data}", async () => {
    const app = appOn();
    app.get("/x", (c) => json(c, Safe.ok({ ok: 1 })));
    const res = await app.request("http://127.0.0.1/x");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { ok: 1 } });
  });

  test("a failure answers its own status, a code, and the variant's extra fields as details", async () => {
    const app = appOn();
    app.get("/x", (c) => json(c, Safe.err(notFound)));
    const res = await app.request("http://127.0.0.1/x");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "NOTE_NOT_FOUND", message: "no such note", details: { id: "n1" } },
    });
  });

  test("a 5xx keeps its reason off the wire: code and message only", async () => {
    expect(errorEnvelope(queryFailed)).toEqual({
      success: false,
      error: { code: "QUERY_FAILED", message: "query failed" },
    });
    const app = appOn();
    app.get("/x", (c) => json(c, Safe.err(queryFailed)));
    const res = await app.request("http://127.0.0.1/x");
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(res.status).toBe(500);
    expect(body.error.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("SQLITE_BUSY");
  });

  test("a defect is one 500 with no internals, and the detail goes to the log", async () => {
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args[0]);
    try {
      const app = appOn();
      app.get("/x", (c) =>
        json(
          c,
          Safe.call(() => {
            throw new Error("sqlite exploded");
          }),
        ),
      );
      const res = await app.request("http://127.0.0.1/x");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "internal error" },
      });
      expect(logged.length).toBe(1);
    } finally {
      console.error = original;
    }
  });
});

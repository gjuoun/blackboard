import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { type ReadingFile, ReadingStateStore } from "../../lib/reading-state";
import { fixture, LOCAL, register } from "../../test/api-fixture";
import { run } from "../../test/app";
import { app } from "../app";

/**
 * The reading route, driven through the API app. The reading state lives in the reading_state table,
 * so "persisted" means: the row the store reads back, the same read a restarted API performs. The
 * original test read a JSON file and asserted the same values; the assertions now read the table.
 */

const send = (payload: unknown) =>
  app.request("http://127.0.0.1/api/reading", {
    method: "POST",
    headers: { ...LOCAL, "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

/** The stored reading state, read through the store the API writes with. */
const stored = (home: string): Promise<ReadingFile["docs"]> =>
  run(
    Effect.gen(function* () {
      const s = yield* ReadingStateStore;
      return (yield* s.read(home)).docs;
    }),
  );

async function setup() {
  const { home, docs } = await fixture("bb-reading-route-", {
    "design.md": "# Design\n\nLater text.\n",
    "notes.md": "# Notes\n\nAnother doc.\n",
  });
  const design = await register(home, join(docs, "design.md"));
  const notes = await register(home, join(docs, "notes.md"));
  return { home, designId: design.id, notesId: notes.id };
}

describe("POST /api/reading", () => {
  test("marks one document read and persists the position it had", async () => {
    const { home, designId } = await setup();
    const res = await send({ session: designId, action: "read" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: { [designId]: { status: "read", progress: 0 } } });
    // The row is what a restarted API reads back.
    expect((await stored(home))[designId]).toMatchObject({ status: "read", progress: 0 });
    expect((await stored(home))[designId].sourceMtime).toBeGreaterThan(0);
  });

  test("marks a document unread and clears its progress", async () => {
    const { home, designId } = await setup();
    await send({ session: designId, action: "read" });
    const res = await send({ session: designId, action: "unread" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: { [designId]: { status: "unread", progress: 0 } } });
    expect((await stored(home))[designId]).toMatchObject({ status: "unread", progress: 0 });
  });

  test("an unknown session is refused with a plain message", async () => {
    await setup();
    const res = await send({ session: "nosuchid", action: "read" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });

  test("an unknown or missing action is refused", async () => {
    const { designId } = await setup();
    expect(await (await send({ session: designId, action: "pause" })).json()).toEqual({
      error: "unknown action",
    });
    expect((await send({ session: designId })).status).toBe(400);
  });

  test("a body that is not JSON is refused as an unknown session", async () => {
    await setup();
    const res = await send("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });
});

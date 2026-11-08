import { describe, expect, test } from "bun:test";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { run } from "../../../test/app";
import { open } from "@/lib/cli/sessions";
import { readReadingState, readingStatePath } from "@/lib/reading-state";
import { POST } from "./route";

/** A temp home with two documents, the same fixture the other route tests build. */
async function setup() {
  const { base, design, notes } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-reading-route-" }));
      const docs = join(base, "docs");
      yield* fs.makeDirectory(docs, { recursive: true });
      const design = join(docs, "design.md");
      const notes = join(docs, "notes.md");
      yield* fs.writeFileString(design, "# Design\n\nLater text.\n");
      yield* fs.writeFileString(notes, "# Notes\n\nAnother doc.\n");
      return { base, design, notes };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  const designSession = await run(open(home, design));
  const notesSession = await run(open(home, notes));
  return { home, design, notes, designId: designSession.session.id, notesId: notesSession.session.id };
}

const send = (payload: unknown) =>
  POST(
    new NextRequest("http://127.0.0.1/api/reading", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );

const stored = (home: string) => readReadingState(readingStatePath(home)).docs;

describe("POST /api/reading", () => {
  test("marks one document read and persists it", async () => {
    const { home, designId } = await setup();
    const res = await send({ session: designId, action: "read" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: { [designId]: { status: "read", progress: 1 } } });
    // The file on disk is what a restarted server reads back.
    expect(stored(home)[designId]).toMatchObject({ status: "read", progress: 1 });
    expect(stored(home)[designId].sourceMtime).toBeGreaterThan(0);
  });

  test("marks a document unread and clears its progress", async () => {
    const { home, designId } = await setup();
    await send({ session: designId, action: "read" });
    const res = await send({ session: designId, action: "unread" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: { [designId]: { status: "unread", progress: 0 } } });
    expect(stored(home)[designId]).toMatchObject({ status: "unread", progress: 0 });
  });

  test("records a mid-document position as reading, and the bottom as read", async () => {
    const { home, designId } = await setup();
    const mid = await send({ session: designId, action: "progress", progress: 0.42 });
    expect(mid.status).toBe(200);
    expect(await mid.json()).toEqual({ docs: { [designId]: { status: "reading", progress: 0.42 } } });
    expect(stored(home)[designId]).toMatchObject({ status: "reading", progress: 0.42 });

    const end = await send({ session: designId, action: "progress", progress: 0.98 });
    expect(await end.json()).toEqual({ docs: { [designId]: { status: "read", progress: 1 } } });
    expect(stored(home)[designId]).toMatchObject({ status: "read", progress: 1 });
  });

  test("read-all marks every registered document read", async () => {
    const { home, designId, notesId } = await setup();
    const res = await send({ action: "read-all" });
    expect(res.status).toBe(200);
    const { docs } = await res.json();
    expect(docs[designId]).toEqual({ status: "read", progress: 1 });
    expect(docs[notesId]).toEqual({ status: "read", progress: 1 });
    expect(stored(home)[designId].status).toBe("read");
    expect(stored(home)[notesId].status).toBe("read");
  });

  test("an unknown session is refused with a plain message", async () => {
    await setup();
    const res = await send({ session: "nosuchid", action: "read" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });

  test("a progress value that is not a number is refused by name", async () => {
    const { designId } = await setup();
    for (const progress of ["0.5", null, undefined]) {
      const res = await send({ session: designId, action: "progress", progress });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "progress must be a number from 0 to 1" });
    }
  });

  test("an unknown or missing action is refused", async () => {
    const { designId } = await setup();
    expect(await (await send({ session: designId, action: "pause" })).json()).toEqual({ error: "unknown action" });
    expect((await send({ session: designId })).status).toBe(400);
  });

  test("a body that is not JSON is refused as an unknown session", async () => {
    await setup();
    const res = await send("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });
});

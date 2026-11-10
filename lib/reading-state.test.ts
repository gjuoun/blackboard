import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markRead, markUnread, withProgress, type ReadingEntry } from "./reading-model";
import { ReadingStateStore, type ReadingFile } from "./reading-state";
import { DocumentsRepo } from "./db/repos/documents";
import { run } from "../test/app";

const at = "2026-11-08T10:00:00.000Z";
const entry = (status: ReadingEntry["status"], progress: number): ReadingEntry => ({ status, progress, readAt: at, sourceMtime: 100 });

/** A temp home with the documents the foreign key points at. */
const fresh = async (...ids: string[]) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "bb-reading-")));
  await run(Effect.gen(function* () {
    const docs = yield* DocumentsRepo;
    for (const id of ids) yield* docs.upsert(home, { id, path: join(home, `${id}.md`) });
  }));
  return home;
};

const read = (home: string): Promise<ReadingFile> =>
  run(Effect.gen(function* () {
    const s = yield* ReadingStateStore;
    return yield* s.read(home);
  }));
const set = (home: string, id: string, e: ReadingEntry): Promise<void> =>
  run(Effect.gen(function* () {
    const s = yield* ReadingStateStore;
    return yield* s.set(home, id, e);
  }));

describe("reading state", () => {
  test("a home without rows reads as empty", async () => {
    expect(await read(await fresh())).toEqual({ version: 1, docs: {} });
  });

  test("round-trips entries through the store", async () => {
    const home = await fresh("a", "b", "c");
    await set(home, "a", entry("unread", 0));
    await set(home, "b", withProgress(0.42, at, 200));
    await set(home, "c", markRead(at, 300, 0.87));
    const back = await read(home);
    expect(back.docs.a.status).toBe("unread");
    expect(back.docs.b).toEqual({ status: "reading", progress: 0.42, readAt: at, sourceMtime: 200 });
    expect(back.docs.c).toMatchObject({ status: "read", progress: 0.87 });
  });

  test("one write leaves the other documents alone", async () => {
    const home = await fresh("a", "b");
    await set(home, "a", markRead(at, 1));
    await set(home, "b", markRead(at, 1));
    await set(home, "b", markUnread(at, 1));
    const back = await read(home);
    expect(back.docs.a.status).toBe("read");
    expect(back.docs.b).toEqual({ status: "unread", progress: 0, readAt: at, sourceMtime: 1 });
  });

  test("a row for an unknown document is refused by the foreign key", async () => {
    const home = await fresh();
    await expect(set(home, "ghost", entry("read", 1))).rejects.toThrow();
  });
});

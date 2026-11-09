import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { run } from "../test/app";
import { markRead, markUnread, withProgress, type ReadingEntry } from "./reading-model";
import { readingStatePath, readReadingState, ReadingStateStore, type ReadingFile } from "./reading-state";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-reading-")));
const at = "2026-11-08T10:00:00.000Z";

/** One store mutation, the way a route or the CLI performs it. */
const mutate = <A>(home: string, change: (file: ReadingFile) => A): Promise<A> =>
  run(
    Effect.gen(function* () {
      const store = yield* ReadingStateStore;
      return yield* store.mutate(home, change);
    }),
  );

const entry = (status: ReadingEntry["status"], progress: number): ReadingEntry => ({ status, progress, readAt: at, sourceMtime: 100 });

describe("reading state file", () => {
  test("a home without the file reads as empty", () => {
    const home = fresh();
    expect(readReadingState(readingStatePath(home))).toEqual({ version: 1, docs: {} });
  });

  test("round-trips entries through the file on disk", async () => {
    const home = fresh();
    await mutate(home, (file) => {
      file.docs.a = entry("unread", 0);
      file.docs.b = withProgress(0.42, at, 200);
      file.docs.c = markRead(at, 300, 0.87);
    });
    // A fresh read is what a restarted process sees.
    const back = readReadingState(readingStatePath(home));
    expect(back.docs.a.status).toBe("unread");
    expect(back.docs.b).toEqual({ status: "reading", progress: 0.42, readAt: at, sourceMtime: 200 });
    expect(back.docs.c).toMatchObject({ status: "read", progress: 0.87 });
    const raw = JSON.parse(readFileSync(readingStatePath(home), "utf8"));
    expect(raw.version).toBe(1);
  });

  test("one write leaves the other documents alone", async () => {
    const home = fresh();
    await mutate(home, (file) => {
      file.docs.a = markRead(at, 1);
      file.docs.b = markRead(at, 1);
    });
    await mutate(home, (file) => {
      file.docs.b = markUnread(at, 1);
    });
    const back = readReadingState(readingStatePath(home));
    expect(back.docs.a.status).toBe("read");
    expect(back.docs.b).toEqual({ status: "unread", progress: 0, readAt: at, sourceMtime: 1 });
  });

  test("a corrupt file is an error, never silently replaced", async () => {
    const home = fresh();
    writeFileSync(readingStatePath(home), "{not json");
    expect(() => readReadingState(readingStatePath(home))).toThrow();
    await expect(mutate(home, (file) => file.docs)).rejects.toThrow();
  });

  test("unknown fields and stray records are dropped on read", () => {
    const home = fresh();
    writeFileSync(
      readingStatePath(home),
      JSON.stringify({
        version: 1,
        docs: {
          good: { status: "reading", progress: 0.3, readAt: at, sourceMtime: 9, extra: true },
          badStatus: { status: "paused", progress: 0.3, readAt: at, sourceMtime: 9 },
          clamped: { status: "read", progress: 4, readAt: at, sourceMtime: 9 },
        },
      }),
    );
    const back = readReadingState(readingStatePath(home));
    expect(Object.keys(back.docs).sort()).toEqual(["clamped", "good"]);
    expect(back.docs.good).toEqual({ status: "reading", progress: 0.3, readAt: at, sourceMtime: 9 });
    expect(back.docs.clamped.progress).toBe(1);
  });
});

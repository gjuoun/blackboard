import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangeBus } from "./change-bus";
import { HEARTBEAT_MS, watchEvents } from "./sse";

const decoder = new TextDecoder();
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A temp folder holding the doc, so fs.watch has something real to report. */
function docsDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "bb-sse-")));
  dirs.push(d);
  writeFileSync(join(d, "design.md"), "# Design\n\nLater text.\n");
  return d;
}

const write = (dir: string, name = "design.md") =>
  writeFileSync(join(dir, name), `# Design\n\nLater text.\n${Date.now()}\n`);

/** The body the route answers with: the doc folder plus the session's change bus. */
function bodyFor(dir: string, bus: ChangeBus, id: string, heartbeatMs = HEARTBEAT_MS, signal?: AbortSignal) {
  return watchEvents({ doc: { dir, name: "design.md" }, session: { bus, id }, heartbeatMs, signal });
}

/**
 * A reader that never loses a frame: one read is in flight at a time, and a window that passes with
 * nothing to say leaves that read pending for the next call instead of swallowing the next event.
 */
function frames(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let pending: Promise<{ value?: Uint8Array; done: boolean }> | null = null;
  const pull = () => {
    if (!pending) {
      pending = reader.read().then((r) => {
        pending = null;
        return r as { value?: Uint8Array; done: boolean };
      });
    }
    return pending as Promise<{ value?: Uint8Array; done: boolean }>;
  };
  return {
    /** The next frame, or "" when the window passes with nothing to say. */
    within: async (ms: number): Promise<string> => {
      const frame = await Promise.race([
        pull().then((r) => decoder.decode(r.value)),
        Bun.sleep(ms).then(() => ""),
      ]);
      return frame;
    },
    /** The next frame that is not a heartbeat. */
    next: async (ms = 2_000): Promise<string> => {
      for (let i = 0; i < 50; i++) {
        const frame = await Promise.race([
          pull().then((r) => decoder.decode(r.value)),
          Bun.sleep(ms).then(() => ""),
        ]);
        if (frame === "") throw new Error(`no frame within ${ms}ms`);
        if (!frame.startsWith(": ping")) return frame;
      }
      throw new Error("no event frame within 50 reads");
    },
  };
}

describe("the watch event stream", () => {
  test("answers with the connected preamble, then one changed batch per window", async () => {
    const dir = docsDir();
    const bus = new ChangeBus();
    const reader = bodyFor(dir, bus, "s1").getReader();
    const f = frames(reader);

    expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");

    const docFrame = f.next();
    write(dir);
    expect(await docFrame).toBe('event: changed\ndata: {"doc":true,"comments":false}\n\n');

    const commentFrame = f.next();
    bus.publish("s1");
    expect(await commentFrame).toBe('event: changed\ndata: {"doc":false,"comments":true}\n\n');

    await reader.cancel();
  });

  test("ignores another file in the doc folder", async () => {
    const dir = docsDir();
    const reader = bodyFor(dir, new ChangeBus(), "s1").getReader();
    const f = frames(reader);
    await reader.read();
    // fsevents can replay the doc's own creation; let that settle before the window under test.
    await f.within(250);

    write(dir, "other.md");
    expect(await f.within(300)).not.toContain('"doc":true');

    write(dir);
    expect(await f.next()).toBe('event: changed\ndata: {"doc":true,"comments":false}\n\n');
    await reader.cancel();
  });

  test("a doc folder that is already gone is an empty watch, not a failed request", async () => {
    const gone = join(realpathSync(mkdtempSync(join(tmpdir(), "bb-sse-"))), "missing");
    dirs.push(gone);
    const reader = bodyFor(gone, new ChangeBus(), "s1").getReader();
    const f = frames(reader);

    expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
    expect(await f.within(300)).toBe("");
    await reader.cancel();
  });

  test("an idle stream sends a ping comment every heartbeat", async () => {
    const dir = docsDir();
    const reader = bodyFor(dir, new ChangeBus(), "s1", 10).getReader();
    const f = frames(reader);
    expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
    expect(await f.within(2_000)).toBe(": ping\n\n");
    await reader.cancel();
  });

  test("a save still arrives as the same changed frame while heartbeats are running", async () => {
    const dir = docsDir();
    const reader = bodyFor(dir, new ChangeBus(), "s1", 10).getReader();
    const f = frames(reader);
    await reader.read();

    const frame = f.next();
    write(dir);
    expect(await frame).toBe('event: changed\ndata: {"doc":true,"comments":false}\n\n');
    await reader.cancel();
  });

  test("aborting the request releases the watcher", async () => {
    const dir = docsDir();
    const abort = new AbortController();
    const reader = bodyFor(dir, new ChangeBus(), "s1", HEARTBEAT_MS, abort.signal).getReader();
    await reader.read();

    abort.abort();
    await Bun.sleep(20);
    const after = await reader.read();
    expect(after.done).toBe(true);
  });

  test("cancelling the body releases the watcher", async () => {
    const dir = docsDir();
    const reader = bodyFor(dir, new ChangeBus(), "s1", 10).getReader();
    await reader.read();
    await reader.cancel();
    const after = await reader.read();
    expect(after.done).toBe(true);
  });
});

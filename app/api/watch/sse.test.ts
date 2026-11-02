import { describe, expect, test } from "bun:test";
import { Cause, Context, Effect, Queue, Stream, type FileSystem } from "effect";
import { commentChanges, docChanges, watchEvents } from "./sse";

type WatchEvent = FileSystem.WatchEvent;

const decoder = new TextDecoder();

/**
 * A watcher as the platform hands it over: a queue of events plus a finalizer. The finalizer is
 * the observable the test watches - `FileSystem.watch` closes its OS watcher in exactly that slot -
 * and the queue lets the test say what the OS reported.
 */
function fakeWatch() {
  const queue = Effect.runSync(Queue.unbounded<WatchEvent, Cause.Done>());
  const state = { closed: false };
  let markStarted = () => {};
  const ready = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  // `unwrap` reports the pull that installs the watcher; `ensuring` is the finalizer that closes it.
  const stream = Stream.unwrap(
    Effect.sync(() => {
      markStarted();
      return Stream.fromQueue(queue).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            state.closed = true;
          }),
        ),
      );
    }),
  );
  return {
    stream,
    ready,
    emit: (event: WatchEvent) => Effect.runPromise(Queue.offer(queue, event)),
    isClosed: () => state.closed,
  };
}

const save = (path: string): WatchEvent => ({ _tag: "Update", path });

/** The SSE body for a doc and its comments folder, with the same abort wiring the route uses. */
function bodyFor(doc: ReturnType<typeof fakeWatch>, comments: ReturnType<typeof fakeWatch>, signal: AbortSignal) {
  const events = watchEvents(docChanges(doc.stream, "design.md"), commentChanges(comments.stream));
  return Stream.toReadableStreamWith(events, Context.empty(), { signal });
}

/**
 * The first chunk is the preamble - byte for byte what the route has always sent. The next pull is
 * what starts the watchers behind the merge, so this waits for them and hands back that read.
 */
async function started(reader: ReadableStreamDefaultReader<Uint8Array>, ...watchers: ReturnType<typeof fakeWatch>[]) {
  expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
  const pending = reader.read();
  await Promise.all(watchers.map((watcher) => watcher.ready));
  return { pending };
}

/** Abort and cancel run a fiber finalizer, so the watcher closes on its own tick rather than inline. */
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error("the watcher was not released");
}

describe("the watch event stream", () => {
  test("answers with the connected preamble, then one changed batch per window", async () => {
    const doc = fakeWatch();
    const comments = fakeWatch();
    const abort = new AbortController();
    const reader = bodyFor(doc, comments, abort.signal).getReader();
    const { pending } = await started(reader, doc, comments);

    await doc.emit(save("design.md"));
    expect(decoder.decode((await pending).value)).toBe('event: changed\ndata: {"doc":true,"comments":false}\n\n');

    const later = reader.read();
    await comments.emit(save("design.md.c_0123456789ab.json"));
    expect(decoder.decode((await later).value)).toBe('event: changed\ndata: {"doc":false,"comments":true}\n\n');

    await reader.cancel();
  });

  test("ignores another file in the doc folder and the comment store's lock and temp files", async () => {
    const doc = fakeWatch();
    const comments = fakeWatch();
    const abort = new AbortController();
    const reader = bodyFor(doc, comments, abort.signal).getReader();
    const { pending } = await started(reader, doc, comments);

    await doc.emit(save("other.md"));
    await comments.emit(save("comments.json.lock"));
    await comments.emit(save("comments.json.1.2.tmp"));
    await doc.emit(save("design.md"));
    // Only the doc save is left pending, so the batch names the doc and nothing else.
    expect(decoder.decode((await pending).value)).toBe('event: changed\ndata: {"doc":true,"comments":false}\n\n');

    await reader.cancel();
  });

  test("a doc folder that is already gone is an empty watch, not a failed request", async () => {
    const comments = fakeWatch();
    const abort = new AbortController();
    const events = watchEvents(docChanges(Stream.fail("ENOENT"), "design.md"), commentChanges(comments.stream));
    const reader = Stream.toReadableStreamWith(events, Context.empty(), { signal: abort.signal }).getReader();
    const { pending } = await started(reader, comments);

    await comments.emit(save("comments.json"));
    expect(decoder.decode((await pending).value)).toBe('event: changed\ndata: {"doc":false,"comments":true}\n\n');

    await reader.cancel();
  });

  test("aborting the request releases both watchers", async () => {
    const doc = fakeWatch();
    const comments = fakeWatch();
    const abort = new AbortController();
    const reader = bodyFor(doc, comments, abort.signal).getReader();
    await started(reader, doc, comments);

    abort.abort();
    await until(() => doc.isClosed() && comments.isClosed());
    expect(doc.isClosed()).toBe(true);
    expect(comments.isClosed()).toBe(true);
    expect((await reader.read()).done).toBe(true);
  });

  test("cancelling the body releases both watchers", async () => {
    const doc = fakeWatch();
    const comments = fakeWatch();
    const abort = new AbortController();
    const reader = bodyFor(doc, comments, abort.signal).getReader();
    await started(reader, doc, comments);

    await reader.cancel();
    await until(() => doc.isClosed() && comments.isClosed());
    expect(doc.isClosed()).toBe(true);
    expect(comments.isClosed()).toBe(true);
  });
});

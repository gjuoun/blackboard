import { FileSystem, Schedule, Stream } from "effect";
import { errorMessage, IoFailure, type ApiFailure } from "@/lib/effect/errors";

const DEBOUNCE_MS = 100;
const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();
const sse = (text: string): Uint8Array => encoder.encode(text);

/** What a batch of changes can name: the doc, its comments, or both. */
type Changed = { doc: boolean; comments: boolean };

/** A doc save: the folder reports a file name, and only the doc itself is a change the page shows. */
export function docChanges<E>(events: Stream.Stream<FileSystem.WatchEvent, E>, docName: string): Stream.Stream<"doc"> {
  return events.pipe(
    Stream.filter((event) => event.path === docName),
    Stream.map(() => "doc" as const),
    // A folder that is already gone has nothing to watch, and that is not a failed request.
    Stream.catchIf((_error): _error is E => true, () => Stream.empty),
  );
}

/** The comments folder: the lock and the temp file the store writes on every change are not changes. */
export function commentChanges<E>(events: Stream.Stream<FileSystem.WatchEvent, E>): Stream.Stream<"comments", ApiFailure> {
  return events.pipe(
    Stream.filter((event) => !event.path.endsWith(".tmp") && !event.path.endsWith(".lock")),
    Stream.map(() => "comments" as const),
    Stream.mapError((error) => new IoFailure({ message: errorMessage(error), status: 500 })),
  );
}

/** One `changed` event per 100 ms that has news, carrying every kind seen since the last one. */
function batches(doc: Stream.Stream<"doc">, comments: Stream.Stream<"comments", ApiFailure>): Stream.Stream<Uint8Array, ApiFailure> {
  const pending: Changed = { doc: false, comments: false };
  const marks = Stream.merge(doc, comments).pipe(
    Stream.map((kind) => {
      pending[kind] = true;
      return kind;
    }),
  );
  // A tick flushes what is pending, so a folder written continuously still reaches the page.
  return Stream.merge(marks, Stream.tick(DEBOUNCE_MS)).pipe(
    Stream.filter(() => pending.doc || pending.comments),
    Stream.map(() => {
      const data = JSON.stringify(pending);
      pending.doc = false;
      pending.comments = false;
      return sse(`event: changed\ndata: ${data}\n\n`);
    }),
  );
}

/**
 * The event stream /api/watch answers with: `: connected` first, one `changed` batch per 100 ms
 * that has news, and a `: ping` every 25 s. Both watchers are read inside this stream, so
 * cancelling the readable stream — or aborting the request — runs their finalizers and closes them.
 */
export function watchEvents(doc: Stream.Stream<"doc">, comments: Stream.Stream<"comments", ApiFailure>): Stream.Stream<Uint8Array, ApiFailure> {
  // The first heartbeat is due after one interval, not at connect.
  const beat = Stream.fromSchedule(Schedule.spaced(HEARTBEAT_MS)).pipe(Stream.map(() => sse(": ping\n\n")));
  return Stream.concat(Stream.make(sse(": connected\n\n")), Stream.merge(batches(doc, comments), beat));
}

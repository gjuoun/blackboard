import { Context, Effect, Layer, PubSub, Stream } from "effect";

/**
 * The mutation legs of /api/watch. With the database there are no files to watch for comments or
 * for a streamed doc's body, so every API mutation publishes a mark on a per-session channel
 * instead. One channel per session carrying "comments" or "doc" marks — "doc" is published only
 * by streamed-doc writes (a file doc's saves still come through its folder watch).
 * Same wire, different source — the event stream is identical.
 */
type Mark = "comments" | "doc";

export class ChangeBus extends Context.Service<
  ChangeBus,
  {
    /** Announce that a session's comment surface changed. */
    publish(sessionId: string): Effect.Effect<void>;
    /** Announce that a session's document changed (a streamed doc's blocks). */
    publishDoc(sessionId: string): Effect.Effect<void>;
    /** The stream of comment-change marks for one session; empty for one that never changes. */
    events(sessionId: string): Effect.Effect<Stream.Stream<"comments">>;
    /** The stream of doc-change marks for one session; empty for one that never changes. */
    docEvents(sessionId: string): Effect.Effect<Stream.Stream<"doc">>;
  }
>()("blackboard/ChangeBus") {}

export const layer = Layer.effect(
  ChangeBus,
  Effect.gen(function* () {
    const channels = new Map<string, PubSub.PubSub<Mark>>();
    const channel = (id: string): Effect.Effect<PubSub.PubSub<Mark>> =>
      Effect.suspend(() => {
        const held = channels.get(id);
        if (held) return Effect.succeed(held);
        // replay: 1 — a watch that subscribes just after a mutation still gets that mark; the
        // cost is at most one stale "changed" at connect, which only makes the page re-read.
        return PubSub.unbounded<Mark>({ replay: 1 }).pipe(Effect.tap((made) => Effect.sync(() => channels.set(id, made))));
      });
    const send = (id: string, mark: Mark) =>
      channel(id).pipe(Effect.flatMap((ch) => PubSub.publish(ch, mark))).pipe(Effect.asVoid, Effect.catch(() => Effect.void));
    const marks = <M extends Mark>(id: string, mark: M): Effect.Effect<Stream.Stream<M>> =>
      channel(id).pipe(Effect.map((ch) => Stream.filter(Stream.fromPubSub(ch), (m): m is M => m === mark)));
    return ChangeBus.of({
      publish: (id) => send(id, "comments"),
      publishDoc: (id) => send(id, "doc"),
      events: (id) => marks(id, "comments"),
      docEvents: (id) => marks(id, "doc"),
    });
  }),
);

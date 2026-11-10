import { Context, Effect, Layer, PubSub, Stream } from "effect";

/**
 * The comments leg of /api/watch. The JSON era watched the session's comments folder; with the
 * database there is no file to watch, so every API mutation publishes "comments" on the
 * session's channel instead. Same wire, different source — the event stream is identical.
 */
export class ChangeBus extends Context.Service<
  ChangeBus,
  {
    /** Announce that a session's comment surface changed. */
    publish(sessionId: string): Effect.Effect<void>;
    /** The stream of comment-change marks for one session; empty for one that never changes. */
    events(sessionId: string): Effect.Effect<Stream.Stream<"comments">>;
  }
>()("blackboard/ChangeBus") {}

export const layer = Layer.effect(
  ChangeBus,
  Effect.gen(function* () {
    const channels = new Map<string, PubSub.PubSub<"comments">>();
    const channel = (id: string): Effect.Effect<PubSub.PubSub<"comments">> =>
      Effect.suspend(() => {
        const held = channels.get(id);
        if (held) return Effect.succeed(held);
        // replay: 1 — a watch that subscribes just after a mutation still gets that mark; the
        // cost is at most one stale "changed" at connect, which only makes the page re-read.
        return PubSub.unbounded<"comments">({ replay: 1 }).pipe(Effect.tap((made) => Effect.sync(() => channels.set(id, made))));
      });
    return ChangeBus.of({
      publish: (id) => channel(id).pipe(Effect.flatMap((ch) => PubSub.publish(ch, "comments")))
        .pipe(Effect.asVoid, Effect.catch(() => Effect.void)),
      events: (id) => channel(id).pipe(Effect.map((ch) => Stream.fromPubSub(ch)))
    });
  }),
);

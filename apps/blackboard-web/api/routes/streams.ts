import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { ChangeBus } from "../../lib/change-bus";
import { bodyRequired, InvalidInput } from "../../lib/effect/errors";
import { jsonBody } from "../../lib/effect/schema";
import { getHome } from "../../lib/home";
import { STREAM_ACTIONS } from "../../lib/stream-doc";
import { StreamsStore } from "../../lib/stream-store";
import { respond } from "../respond";

/**
 * The streamed-document write surface: create a stream, then write exchanges into it. Reads stay
 * on /api/session — a stream is just a session whose body is the block fold.
 *
 * POST /api/stream {title}           — register a streamed doc; answers {session}.
 * POST /api/block  {session, ...}    — append an exchange, or rewrite one when `edit` names a
 *                                      block id. Answers the written {block}.
 */

const StreamPost = Schema.Struct({ title: Schema.NonEmptyString });
const BlockPost = Schema.Struct({
  session: Schema.NonEmptyString,
  action: Schema.optional(Schema.Literals(STREAM_ACTIONS)),
  body: Schema.String,
  author: Schema.NonEmptyString,
  images: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(Schema.Literal("writing")),
  edit: Schema.optional(Schema.NonEmptyString),
});

const bad = (message: string, field?: string) => new InvalidInput({ message, status: 400, field });

export const streams = new Hono();

/** POST /api/stream {title} — a new streamed document. */
streams.post("/stream", (c) =>
  respond(
    Effect.gen(function* () {
      const store = yield* StreamsStore;
      const bus = yield* ChangeBus;
      const home = getHome();
      const raw = yield* jsonBody(c.req.raw);
      const parsed = yield* Schema.decodeUnknownEffect(StreamPost)(raw).pipe(
        Effect.mapError(() => bad("title is required", "title")),
      );
      const session = yield* store.create(home, parsed.title);
      yield* bus.publishDoc(session.id);
      return { session };
    }),
    201,
  ),
);

/** POST /api/block {session, action|edit, body, author, images?, status?} — write one exchange. */
streams.post("/block", (c) =>
  respond(
    Effect.gen(function* () {
      const store = yield* StreamsStore;
      const bus = yield* ChangeBus;
      const home = getHome();
      const raw = yield* jsonBody(c.req.raw);
      const input = yield* Schema.decodeUnknownEffect(BlockPost)(raw).pipe(
        Effect.mapError((error) => bad(error.message.split("\n")[0])),
      );
      if (!input.body.trim()) return yield* bodyRequired();
      if (input.edit !== undefined && input.action !== undefined) {
        return yield* bad("edit and action are exclusive", "edit");
      }
      const block =
        input.edit !== undefined
          ? yield* store.edit(home, input.session, input.edit, input.body, input.status)
          : yield* store.append(home, input.session, {
              action: input.action ?? "answer",
              body: input.body,
              author: input.author,
              images: input.images ? [...input.images] : undefined,
              status: input.status,
            });
      yield* bus.publishDoc(input.session);
      return { block };
    }),
    201,
  ),
);

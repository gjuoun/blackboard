import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { InvalidInput } from "../../lib/effect/errors";
import { getHome } from "../../lib/home";
import { renderMarkdown } from "../../lib/markdown";
import { SessionsStore } from "../../lib/sessions";
import { parseRange } from "../../lib/stream-window";
import { StreamsStore } from "../../lib/stream-store";
import { respond } from "../respond";

/**
 * Lazy content for a streamed doc's timeline: the first screen ships a window, and every
 * exchange outside it arrives through this endpoint as rendered HTML the lazy loader drops
 * into its placeholder. Renders exactly like the page does — same renderer, same assetBase —
 * so a filled placeholder and a served section are indistinguishable.
 */
export const streamBlocks = new Hono();

const bad = (message: string, field?: string) => new InvalidInput({ message, status: 400, field });

const RangeParams = Schema.Struct({
  id: Schema.NonEmptyString,
  from: Schema.String,
  to: Schema.String,
  vh: Schema.optional(Schema.String),
});

/** GET /api/stream-blocks?id=&from=&to=&vh= — rendered exchanges for a range of a stream. */
streamBlocks.get("/stream-blocks", (c) =>
  respond(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const store = yield* StreamsStore;
      const home = getHome();
      const url = new URL(c.req.url);
      const params = yield* Schema.decodeUnknownEffect(RangeParams)({
        id: url.searchParams.get("id") ?? "",
        from: url.searchParams.get("from") ?? "",
        to: url.searchParams.get("to") ?? "",
        vh: url.searchParams.get("vh") ?? undefined,
      }).pipe(Effect.mapError(() => bad("id, from and to are required")));
      const session = yield* sessions.get(home, params.id);
      if (!session) return yield* Effect.fail(bad("unknown session", "id"));
      const blocks = yield* store.blocks(home, session.id);
      const range = parseRange(`${params.from}:${params.to}`, blocks.length);
      if (range === "invalid" || range === null) return yield* Effect.fail(bad("invalid range", "from"));
      const slice = blocks.slice(range.from, range.to + 1);
      const rendered = yield* Effect.tryPromise({
        try: async () =>
          await Promise.all(slice.map(async (b) => ({ id: b.id, n: b.n, html: (await renderMarkdown(b.body, { assetBase: `/api/asset/${session.id}` })).html }))),
        catch: (error) => bad(String(error)),
      });
      const epoch = `${blocks.length}:${blocks.reduce((n, b) => n + b.body.length, 0)}`;
      return { blocks: rendered, total: blocks.length, epoch };
    }),
  ),
);

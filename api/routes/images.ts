import { Effect } from "effect";
import { Hono } from "hono";
import { readImage, saveImage } from "../../lib/comment-image-store";
import { errorMessage, IoFailure, type ApiFailure } from "../../lib/effect/errors";
import { getHome } from "../../lib/home";
import { respond, respondRaw } from "../respond";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const notFound = (): Effect.Effect<never, ApiFailure> => Effect.fail(new IoFailure({ message: "not found", status: 404 }));

export const images = new Hono();

/** POST raw image bytes. The bytes are sniffed; the Content-Type the client sent is ignored. */
images.post("/", (c) =>
  respond(
    Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => c.req.raw.arrayBuffer(),
        catch: (error) => new IoFailure({ message: errorMessage(error), status: 500 }),
      });
      const saved = yield* saveImage(getHome(), new Uint8Array(raw));
      return { id: saved.id };
    }),
  ),
);

/** GET one stored image. The id must match the sha256 name pattern; anything else is a 404. */
images.get("/:id", (c) =>
  respondRaw(
    Effect.gen(function* () {
      const bytes = yield* readImage(getHome(), c.req.param("id"));
      if (!bytes) return yield* notFound();
      const ext = c.req.param("id").slice(c.req.param("id").lastIndexOf(".") + 1);
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": MIME[ext], "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable" },
      });
    }),
  ),
);

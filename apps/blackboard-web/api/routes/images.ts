import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { readImage, saveImage } from "../../lib/comment-image-store";
import { type ApiFailure, errorMessage, failures, IoFailure } from "../../lib/errors";
import { getHome } from "../../lib/home";
import { json, raw } from "../platform/http/envelope";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const notFound = () => failures.IoFailure("not found", 404);

export const imagesRoutes = () => {
  const app = new Hono();

  /** POST raw image bytes. The bytes are sniffed; the Content-Type the client sent is ignored. */
  app.post("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const buf = (yield Safe.call(
          async () => await c.req.raw.arrayBuffer(),
          (error) => failures.IoFailure(errorMessage(error), 500),
        )) as ArrayBuffer;
        const saved = (yield saveImage(getHome(), new Uint8Array(buf))) as { id: string };
        return { id: saved.id };
      }) as unknown as Safe<{ id: string }, ApiFailure>,
    ),
  );

  /** GET one stored image. The id must match the sha256 name pattern; anything else is a 404. */
  app.get("/:id", (c) =>
    raw(
      c,
      Safe.try(function* () {
        const id = c.req.param("id");
        const bytes = (yield readImage(getHome(), id)) as Uint8Array | null;
        if (!bytes) return (yield Safe.err(notFound())) as never;
        const ext = id.slice(id.lastIndexOf(".") + 1);
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": MIME[ext],
            "x-content-type-options": "nosniff",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }) as unknown as Safe<Response, ApiFailure>,
    ),
  );

  return app;
};

import { Effect } from "effect";
import { Hono } from "hono";
import { InvalidInput, sessionNotFound } from "../../lib/effect/errors";
import { decodeBody, jsonBody, ReadingPostBody, readingReject } from "../../lib/effect/schema";
import { getHome } from "../../lib/home";
import { applyReading, previewDoc } from "../../lib/reading-workspace";
import { respond } from "../respond";

export const reading = new Hono();

/** POST /api/reading {session, action, progress?} — one document's state change, or read-all. */
reading.post("/", (c) =>
  respond(
    Effect.gen(function* () {
      const raw = yield* jsonBody(c.req.raw);
      if (raw === null) return yield* Effect.fail(sessionNotFound(400));
      const body = yield* decodeBody(ReadingPostBody, raw, readingReject);
      if (!body.action) return yield* Effect.fail(new InvalidInput({ message: "unknown action", status: 400, field: "action" }));
      return yield* applyReading(getHome(), { session: body.session, action: body.action, progress: body.progress });
    }),
  ),
);

/** GET /api/reading/doc?session= — the document rendered for the preview, plus its general-comment thread. */
reading.get("/doc", (c) =>
  respond(
    Effect.gen(function* () {
      const data = yield* previewDoc(getHome(), new URL(c.req.url).searchParams.get("session") ?? "");
      if (!data) return yield* Effect.fail(sessionNotFound(400));
      return data;
    }),
  ),
);

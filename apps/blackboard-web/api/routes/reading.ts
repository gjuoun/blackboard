import { Safe } from "@gjuoun/safe-ts";
import { Hono } from "hono";
import { decodeBody, jsonBody, ReadingPostBody, readingReject } from "../../lib/body-schema";
import type { CommentsStore } from "../../lib/comments-store";
import { type ApiFailure, failures, InvalidInput, sessionNotFound } from "../../lib/errors";
import { getHome } from "../../lib/home";
import type { ReadingResult } from "../../lib/reading-model";
import type { ReadingStateStore } from "../../lib/reading-state";
import { applyReading, previewDoc, type ReadingInput } from "../../lib/reading-workspace";
import type { SessionsStore } from "../../lib/sessions";
import { json } from "../platform/http/envelope";

export const readingRoutes = (sessions: SessionsStore, state: ReadingStateStore, comments: CommentsStore) => {
  const app = new Hono();

  /** POST /api/reading {session, action} — one document's read or unread mark. */
  app.post("/", (c) =>
    json(
      c,
      Safe.try(function* () {
        const raw = (yield jsonBody(c.req.raw)) as unknown | null;
        if (raw === null) return (yield Safe.err(sessionNotFound(400))) as never;
        const body = (yield decodeBody(ReadingPostBody, raw, readingReject)) as {
          session?: string;
          action?: "read" | "unread";
        };
        if (!body.action)
          return (yield Safe.err(failures.InvalidInput("unknown action", "action", 400))) as never;
        const input: ReadingInput = { session: body.session, action: body.action };
        return (yield applyReading(sessions, state, getHome(), input)) as ReadingResult;
      }) as unknown as Safe<ReadingResult, ApiFailure>,
    ),
  );

  /** GET /api/reading/doc?session= — the document rendered for the preview, plus its general thread. */
  app.get("/doc", (c) =>
    json(
      c,
      Safe.try(function* () {
        const data = (yield previewDoc(
          sessions,
          comments,
          getHome(),
          new URL(c.req.url).searchParams.get("session") ?? "",
        )) as Awaited<ReturnType<typeof previewDoc>>;
        if (!data) return (yield Safe.err(sessionNotFound(400))) as never;
        return data;
      }) as unknown as Safe<unknown, ApiFailure>,
    ),
  );

  return app;
};

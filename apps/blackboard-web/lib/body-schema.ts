import { Pipe, Safe } from "@gjuoun/safe-ts";
import { z } from "zod";
import { type ApiFailure, bodyRequired, failures, InvalidInput, sessionNotFound } from "./errors";

/**
 * The request bodies the routes accept, decoded at the boundary. A field is typed only where the
 * route already answers a rejection with one fixed message; the fields the route coerces (author,
 * quote, general) stay unknown, so a value the old hand-written check accepted is still accepted
 * and the JSON on the wire does not move.
 */
export const ACTIONS = [
  "reply",
  "resolve",
  "reopen",
  "edit",
  "delete",
  "edit-reply",
  "delete-reply",
] as const;

/** POST /api/comments: one new comment on a passage, or on nothing. */
export const CommentPostBody = z.object({
  session: z.string(),
  body: z.string().optional(),
  images: z.array(z.string()).optional(),
  quote: z.unknown().optional(),
  general: z.unknown().optional(),
  author: z.unknown().optional(),
});

/** POST /api/bind: the document, the pi session that opened it, and the listener it runs. */
export const BindPostBody = z.object({
  session: z.string().optional(),
  piSession: z.string().optional(),
  url: z.string().optional(),
});

/** PATCH /api/comments: the action union, with the fields each action needs. */
export const CommentPatchBody = z.object({
  session: z.string(),
  id: z.string().optional(),
  action: z.enum(ACTIONS).optional(),
  body: z.string().optional(),
  replyId: z.string().optional(),
  author: z.unknown().optional(),
});

/** POST /api/reading: one document's state change. There is no `read-all` — it had no caller. */
export const READING_ACTIONS = ["read", "unread"] as const;
export const ReadingPostBody = z.object({
  session: z.string().optional(),
  action: z.enum(READING_ACTIONS).optional(),
  progress: z.unknown().optional(),
});

/** The request body as a value; a body that is not JSON is null, exactly as a hand-written catch returned. */
export const jsonBody = (req: Request): Safe<unknown | null, never> =>
  Safe.try(function* () {
    const text = (yield (
      Safe.call(
        async () => await req.text(),
        (error) => ({ Body: error }),
      ) as unknown as Safe<string, { Body: unknown }>
    ).pipe(Pipe.catchTag("Body", () => Safe.ok(null)))) as string | null;
    if (text === null) return null;
    return (yield (
      Safe.call(
        () => JSON.parse(text) as unknown,
        (error) => ({ Parse: error }),
      ) as unknown as Safe<unknown, { Parse: unknown }>
    ).pipe(Pipe.catchTag("Parse", () => Safe.ok(null)))) as unknown;
  }) as unknown as Safe<unknown | null, never>;

/**
 * Decode a body, turning every rejection into the failure the route already answers. The key named is
 * the first one the schema complained about, which is what the route's reject function switches on.
 */
export function decodeBody<T>(
  schema: z.ZodType<T>,
  input: unknown,
  reject: (key: string) => ApiFailure,
): Safe<T, ApiFailure> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return Safe.ok(parsed.data);
  return Safe.err(reject(String(parsed.error.issues[0]?.path[0] ?? "")));
}

/** POST: only a body or an image list has a message of its own; everything else is "unknown session". */
export const postReject = (key: string): ApiFailure =>
  key === "body"
    ? bodyRequired()
    : key === "images"
      ? failures.InvalidInput("images must be up to 4 stored image ids", "images", 400)
      : sessionNotFound(400);

/** POST /api/bind: a missing session is an unknown document; every other key names its own message. */
export const bindReject = (key: string): ApiFailure => {
  if (key === "piSession") return failures.InvalidInput("piSession is required", "piSession", 400);
  if (key === "url") return failures.InvalidInput("url must be a loopback http url", "url", 400);
  return sessionNotFound(400);
};

/** PATCH: replyId is named by two different messages, so the action picks which one. */
export const patchReject =
  (action: unknown) =>
  (key: string): ApiFailure => {
    if (key === "id") return failures.InvalidInput("id is required", "id", 400);
    if (key === "action") return failures.InvalidInput("unknown action", "action", 400);
    if (key === "body") return bodyRequired();
    if (key === "replyId") {
      return action === "reply"
        ? failures.InvalidInput("replyId must be a reply id", "replyId", 400)
        : failures.InvalidInput("replyId is required", "replyId", 400);
    }
    return sessionNotFound(400);
  };

/** POST /api/reading: a progress field of the wrong type names itself; everything else is an unknown document. */
export const readingReject = (key: string): ApiFailure =>
  key === "progress"
    ? failures.InvalidInput("progress must be a number from 0 to 1", "progress", 400)
    : key === "action"
      ? failures.InvalidInput("unknown action", "action", 400)
      : sessionNotFound(400);

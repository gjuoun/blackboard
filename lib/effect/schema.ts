import { Effect, Schema, SchemaIssue } from "effect";
import { bodyRequired, InvalidInput, sessionNotFound, type ApiFailure } from "./errors";

/**
 * The request bodies the routes accept, decoded at the boundary. A field is typed only where the
 * route already answers a rejection with one fixed message; the fields the route coerces (author,
 * quote, general) stay Unknown, so a value the old hand-written check accepted is still accepted
 * and the JSON on the wire does not move.
 */
export const ACTIONS = ["reply", "resolve", "reopen", "edit", "delete", "edit-reply", "delete-reply"] as const;

/** POST /api/comments: one new comment on a passage, or on nothing. */
export const CommentPostBody = Schema.Struct({
  session: Schema.String,
  body: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(Schema.String)),
  quote: Schema.optional(Schema.Unknown),
  general: Schema.optional(Schema.Unknown),
  author: Schema.optional(Schema.Unknown),
});
export type CommentPostBody = typeof CommentPostBody.Type;

/** POST /api/bind: the document, the pi session that opened it, and the listener it runs. */
export const BindPostBody = Schema.Struct({
  session: Schema.optional(Schema.String),
  piSession: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
export type BindPostBody = typeof BindPostBody.Type;

/** PATCH /api/comments: the action union, with the fields each action needs. */
export const CommentPatchBody = Schema.Struct({
  session: Schema.String,
  id: Schema.optional(Schema.String),
  action: Schema.optional(Schema.Literals(ACTIONS)),
  body: Schema.optional(Schema.String),
  replyId: Schema.optional(Schema.String),
  author: Schema.optional(Schema.Unknown),
});
export type CommentPatchBody = typeof CommentPatchBody.Type;

/** The request body as a value; a body that is not JSON is null, exactly as a hand-written catch returned. */
export const jsonBody = (req: Request): Effect.Effect<unknown | null> =>
  Effect.tryPromise(() => req.json()).pipe(Effect.catch(() => Effect.succeed(null)));

/** The first property a decode failure points at; empty when the value itself is the wrong shape. */
function firstPath(issue: SchemaIssue.Issue): ReadonlyArray<PropertyKey> {
  switch (issue._tag) {
    case "Pointer":
      return issue.path;
    case "Composite":
      return issue.issues[0] ? firstPath(issue.issues[0]) : [];
    case "Encoding":
    case "Filter":
      return firstPath(issue.issue);
    default:
      return [];
  }
}

/** The key a decode failure names, or "" when it names none. */
export const failedKey = (issue: SchemaIssue.Issue): string => String(firstPath(issue)[0] ?? "");

/** Decode a body, turning every schema rejection into the failure the route already answers. */
export function decodeBody<T extends Schema.Constraint>(
  schema: T,
  input: unknown,
  reject: (key: string) => ApiFailure,
) {
  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.catchTag("SchemaError", (error) => Effect.fail(reject(failedKey(error.issue)))),
  );
}

/** POST: only a body or an image list has a message of its own; everything else is "unknown session". */
export const postReject = (key: string): ApiFailure =>
  key === "body"
    ? bodyRequired()
    : key === "images"
      ? new InvalidInput({ message: "images must be up to 4 stored image ids", status: 400, field: "images" })
      : sessionNotFound(400);

/** POST /api/bind: a missing session is an unknown document; every other key names its own message. */
export const bindReject = (key: string): ApiFailure => {
  if (key === "piSession") return new InvalidInput({ message: "piSession is required", status: 400, field: "piSession" });
  if (key === "url") return new InvalidInput({ message: "url must be a loopback http url", status: 400, field: "url" });
  return sessionNotFound(400);
};

/** PATCH: replyId is named by two different messages, so the action picks which one. */
export const patchReject = (action: unknown) => (key: string): ApiFailure => {
  if (key === "id") return new InvalidInput({ message: "id is required", status: 400, field: "id" });
  if (key === "action") return new InvalidInput({ message: "unknown action", status: 400, field: "action" });
  if (key === "body") return bodyRequired();
  if (key === "replyId") {
    return action === "reply"
      ? new InvalidInput({ message: "replyId must be a reply id", status: 400, field: "replyId" })
      : new InvalidInput({ message: "replyId is required", status: 400, field: "replyId" });
  }
  return sessionNotFound(400);
};
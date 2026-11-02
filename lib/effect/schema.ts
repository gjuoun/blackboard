import { Effect, Schema, SchemaIssue } from "effect";
import { bodyRequired, InvalidInput, sessionNotFound, type ApiFailure } from "./errors";

/**
 * The request bodies the routes accept, decoded at the boundary. A field is typed only where the
 * route already answers a rejection with one fixed message; the fields the route coerces (author,
 * quote, code, general) stay Unknown, so a value the old hand-written check accepted is still
 * accepted and the JSON on the wire does not move.
 */
export const ACTIONS = ["reply", "resolve", "reopen", "edit", "delete", "edit-reply", "delete-reply"] as const;

/** POST /api/comments: one new comment on a passage, on a diff line, or on nothing. */
export const CommentPostBody = Schema.Struct({
  session: Schema.String,
  body: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(Schema.String)),
  quote: Schema.optional(Schema.Unknown),
  code: Schema.optional(Schema.Unknown),
  general: Schema.optional(Schema.Unknown),
  author: Schema.optional(Schema.Unknown),
});
export type CommentPostBody = typeof CommentPostBody.Type;

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
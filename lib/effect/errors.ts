import { Data } from "effect";

/** The HTTP codes a route answers with. */
type WireStatus = 400 | 404 | 500;

/**
 * What every failure carries: the status to answer with and the exact `error` string the route
 * emitted before this layer existed. Mapping a failure to a response is therefore mechanical,
 * and the JSON on the wire is unchanged.
 */
type Wire = { readonly message: string; readonly status: WireStatus };

/** The id names no registered session. 400 on the comments and watch faces, 404 on /api/pr. */
export class SessionNotFound extends Data.TaggedError("SessionNotFound")<Wire> {}

/** The id names no comment in the session's doc. */
export class CommentNotFound extends Data.TaggedError("CommentNotFound")<Wire> {}

/** The id names no reply on that comment. */
export class ReplyNotFound extends Data.TaggedError("ReplyNotFound")<Wire> {}

/** A request that does not satisfy the route's contract. `field` names the key at fault when there is one. */
export class InvalidInput extends Data.TaggedError("InvalidInput")<Wire & { readonly field?: string }> {}

/** The comment file stayed locked past the wait. */
export class LockTimeout extends Data.TaggedError("LockTimeout")<Wire> {}

/** Disk work failed: a missing file, an unreadable one, a write that did not land. */
export class IoFailure extends Data.TaggedError("IoFailure")<Wire> {}

/** A git command the diff or the pr pin depends on failed. */
export class GitFailure extends Data.TaggedError("GitFailure")<Wire> {}

/** The SQLite data layer failed: a bad open, a rejected write, an unsupported runtime. */
export class DbFailure extends Data.TaggedError("DbFailure")<Wire> {}

/** An upload that is not a png, jpeg, gif or webp, or is too big. */
export class ImageRejected extends Data.TaggedError("ImageRejected")<Wire> {}

/** Everything a request program can fail with. */
export type ApiFailure =
  | SessionNotFound
  | CommentNotFound
  | ReplyNotFound
  | InvalidInput
  | LockTimeout
  | IoFailure
  | GitFailure
  | ImageRejected
  | DbFailure;

/** The one string every face uses for an id that names no session. */
export const sessionNotFound = (status: WireStatus): SessionNotFound => new SessionNotFound({ message: "unknown session", status });

/** A thrown value as the message a response carries. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A mutation that arrived without its body. */
export const bodyRequired = (): InvalidInput => new InvalidInput({ message: "body is required", status: 400, field: "body" });

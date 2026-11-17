import { Errors, type ErrorsOf, type FailureOf } from "@gjuoun/safe-ts";

/**
 * Every failure a request program can produce, declared once as a catalog: the key is the tag and the
 * factory's return value is the payload. A failure is therefore a plain value — `{ IoFailure: { … } }`
 * — which is exactly what `Pipe.catchTag` matches on and what the wire envelope carries, so no class
 * ever appears in a signature and no conversion is needed on the way out.
 *
 * `status` rides in the payload: a variant's factory takes it where one situation answers two codes
 * (an unknown session is 400 on the comment faces and 404 on the asset one), because the caller knows
 * which face it is on and the catalog does not.
 */

/** The HTTP codes a route answers with. */
export type WireStatus = 400 | 404 | 500;

export const failures = Errors.define({
  /** The id names no registered session. */
  SessionNotFound: (message: string, status: WireStatus = 400) => ({ status, message }),
  /** The id names no comment in the session's doc. */
  CommentNotFound: (message: string, status: WireStatus = 404) => ({ status, message }),
  /** The id names no reply on that comment. */
  ReplyNotFound: (message: string, status: WireStatus = 404) => ({ status, message }),
  /** A request that does not satisfy the route's contract; `field` names the key at fault. */
  InvalidInput: (message: string, field?: string, status: WireStatus = 400) => ({
    status,
    message,
    ...(field === undefined ? {} : { field }),
  }),
  /** The comment file stayed locked past the wait. */
  LockTimeout: (message: string, status: WireStatus = 400) => ({ status, message }),
  /** Disk work failed: a missing file, an unreadable one, a write that did not land. */
  IoFailure: (message: string, status: WireStatus = 500) => ({ status, message }),
  /** A git command the diff or the pr pin depends on failed. */
  GitFailure: (message: string, status: WireStatus = 500) => ({ status, message }),
  /** The SQLite data layer failed: a bad open, a rejected write, an unsupported runtime. */
  DbFailure: (message: string, status: WireStatus = 500) => ({ status, message }),
  /** An upload that is not a png, jpeg, gif or webp, or is too big. */
  ImageRejected: (message: string, status: WireStatus = 400) => ({ status, message }),
});

/** One arm of the catalog: `{ Tag: { status, message, …details } }`. */
export type SessionNotFound = FailureOf<typeof failures, "SessionNotFound">;
export type CommentNotFound = FailureOf<typeof failures, "CommentNotFound">;
export type ReplyNotFound = FailureOf<typeof failures, "ReplyNotFound">;
export type InvalidInput = FailureOf<typeof failures, "InvalidInput">;
export type LockTimeout = FailureOf<typeof failures, "LockTimeout">;
export type IoFailure = FailureOf<typeof failures, "IoFailure">;
export type GitFailure = FailureOf<typeof failures, "GitFailure">;
export type DbFailure = FailureOf<typeof failures, "DbFailure">;
export type ImageRejected = FailureOf<typeof failures, "ImageRejected">;

/** Everything a request program can fail with. */
export type ApiFailure = ErrorsOf<typeof failures>;

/** The one string every face uses for an id that names no session. */
export const sessionNotFound = (status: WireStatus = 400): SessionNotFound =>
  failures.SessionNotFound("unknown session", status);

/** A thrown value as the message a response carries. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A mutation that arrived without its body. */
export const bodyRequired = (): InvalidInput => failures.InvalidInput("body is required", "body");

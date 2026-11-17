/**
 * What a request program can fail with, and the status it answers. These are plain classes: no
 * Effect, no tagged-error machinery — a failure is a value with a `_tag`, a `message` and the HTTP
 * status the route answers with. Mapping one to a response is therefore mechanical, and the JSON on
 * the wire is unchanged by this file's shape.
 *
 * The per-domain catalogs (`Errors.define`) arrive with each domain's move off Effect; this module
 * keeps the shared vocabulary they will be built from.
 */

/** The HTTP codes a route answers with. */
export type WireStatus = 400 | 404 | 500;

/** What every failure carries: the status to answer with and the message the route prints. */
export type Wire = { readonly message: string; readonly status: WireStatus };

/** One failure: a `_tag` for dispatch, `message`/`status` for the wire, and whatever else it carries. */
export abstract class WireFailure<Tag extends string> {
  readonly _tag: Tag;
  readonly message: string;
  readonly status: WireStatus;

  constructor(tag: Tag, wire: Wire & Record<string, unknown>) {
    this._tag = tag;
    this.message = wire.message;
    this.status = wire.status;
    Object.assign(this, wire);
  }
}

/** The id names no registered session. 400 on the comments and watch faces, 404 on /api/pr. */
export class SessionNotFound extends WireFailure<"SessionNotFound"> {
  constructor(wire: Wire) {
    super("SessionNotFound", wire);
  }
}

/** The id names no comment in the session's doc. */
export class CommentNotFound extends WireFailure<"CommentNotFound"> {
  constructor(wire: Wire) {
    super("CommentNotFound", wire);
  }
}

/** The id names no reply on that comment. */
export class ReplyNotFound extends WireFailure<"ReplyNotFound"> {
  constructor(wire: Wire) {
    super("ReplyNotFound", wire);
  }
}

/** A request that does not satisfy the route's contract. `field` names the key at fault when there is one. */
export class InvalidInput extends WireFailure<"InvalidInput"> {
  readonly field?: string;
  constructor(wire: Wire & { readonly field?: string }) {
    super("InvalidInput", wire);
    this.field = wire.field;
  }
}

/** The comment file stayed locked past the wait. */
export class LockTimeout extends WireFailure<"LockTimeout"> {
  constructor(wire: Wire) {
    super("LockTimeout", wire);
  }
}

/** Disk work failed: a missing file, an unreadable one, a write that did not land. */
export class IoFailure extends WireFailure<"IoFailure"> {
  constructor(wire: Wire) {
    super("IoFailure", wire);
  }
}

/** A git command the diff or the pr pin depends on failed. */
export class GitFailure extends WireFailure<"GitFailure"> {
  constructor(wire: Wire) {
    super("GitFailure", wire);
  }
}

/** The SQLite data layer failed: a bad open, a rejected write, an unsupported runtime. */
export class DbFailure extends WireFailure<"DbFailure"> {
  constructor(wire: Wire) {
    super("DbFailure", wire);
  }
}

/** An upload that is not a png, jpeg, gif or webp, or is too big. */
export class ImageRejected extends WireFailure<"ImageRejected"> {
  constructor(wire: Wire) {
    super("ImageRejected", wire);
  }
}

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
export const sessionNotFound = (status: WireStatus): SessionNotFound =>
  new SessionNotFound({ message: "unknown session", status });

/** A thrown value as the message a response carries. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A mutation that arrived without its body. */
export const bodyRequired = (): InvalidInput =>
  new InvalidInput({ message: "body is required", status: 400, field: "body" });

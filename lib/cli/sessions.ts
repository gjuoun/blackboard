import { Effect } from "effect";
import { cliFailure, CliError, find } from "../cli";
import { docType } from "../doc-type";
import { errorMessage } from "../effect/errors";
import { realDoc, SessionsStore, type Session, type SessionKind, type SessionRow } from "../sessions";
import { StreamStore } from "../stream-store";

const DEFAULT_URL = "http://127.0.0.1:38770";

/** Where the web app shows a session: $BLACKBOARD_URL (default the local app) + /s/<id>. */
export const sessionUrl = (id: string) => `${(process.env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, "")}/s/${id}`;

/** Where the web app shows one block of a stream: the session URL with the block's stable id as its fragment. */
export const blockUrl = (id: string, block: string) => `${sessionUrl(id)}#${block}`;

/**
 * Register a markdown file as a session (again is fine) and give its URL.
 *
 * A stream session also gets its metadata line. meta.title is used when given, else the session
 * id; a file that already has content is never rewritten (old files are migrated with writeMeta).
 */
export function open(
  home: string,
  file: string,
  cwd = process.cwd(),
  kind?: SessionKind,
  meta?: { title?: string; owner?: string },
): Effect.Effect<{ session: Session; url: string }, CliError, SessionsStore | StreamStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const streams = yield* StreamStore;
    const real = yield* Effect.try({ try: () => realDoc(file, cwd), catch: (error) => cliFailure({ message: errorMessage(error) }) });
    const kinded = docType(real, kind ?? "plain");
    if (!kinded.ok) return yield* new CliError({ message: kinded.error, code: 2 });
    const session = yield* sessions.open(home, real, cwd, kind).pipe(Effect.mapError((error) => cliFailure(error)));
    if ((kind ?? session.kind) === "stream") {
      const title = meta?.title?.trim() || session.id;
      const owner = meta?.owner?.trim();
      yield* streams.create(real, { title, ...(owner ? { owner } : {}) }).pipe(Effect.mapError((error) => cliFailure(error)));
    }
    return { session, url: sessionUrl(session.id) };
  });
}

/** Every registered session with its title, location, branch and open comment count. */
export function sessions(home: string): Effect.Effect<SessionRow[], CliError, SessionsStore> {
  return Effect.gen(function* () {
    const store = yield* SessionsStore;
    return yield* store.rows(home).pipe(Effect.mapError((error) => cliFailure(error)));
  });
}

/** Forget a session. Its comment folder stays, so opening the file again brings the comments back. */
export function close(home: string, ref: string, cwd = process.cwd()): Effect.Effect<Session, CliError, SessionsStore> {
  return Effect.gen(function* () {
    const store = yield* SessionsStore;
    const { session } = yield* find(home, ref, cwd);
    return yield* store.close(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
  });
}

import { Effect } from "effect";
import { cliFailure, CliError, find } from "../cli";
import { errorMessage } from "../effect/errors";
import { realDoc, SessionsStore, type Session, type SessionRow } from "../sessions";

const DEFAULT_URL = "http://127.0.0.1:38770";

/** Where the web app shows a session: $BLACKBOARD_URL (default the local app) + /s/<id>. */
export const sessionUrl = (id: string) => `${(process.env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, "")}/s/${id}`;

/** Register a markdown file as a session (again is fine) and give its URL. */
export function open(
  home: string,
  file: string,
  cwd = process.cwd(),
): Effect.Effect<{ session: Session; url: string }, CliError, SessionsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const real = yield* Effect.try({ try: () => realDoc(file, cwd), catch: (error) => cliFailure({ message: errorMessage(error) }) });
    const session = yield* sessions.open(home, real, cwd).pipe(Effect.mapError((error) => cliFailure(error)));
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

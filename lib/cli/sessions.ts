import { Effect } from "effect";
import { apiGet, apiPost, apiUrl, type ApiFailure } from "../api-client";
import { cliFailure, CliError, find } from "../cli";
import { errorMessage } from "../effect/errors";
import { realDoc, SessionsStore, type Session, type SessionRow } from "../sessions";

const DEFAULT_URL = "http://127.0.0.1:38770";

/** Where the web app shows a session: $BLACKBOARD_URL (default the local app) + /s/<id>. */
export const sessionUrl = (id: string) => `${(process.env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, "")}/s/${id}`;

/** Offline is allowed only under Bun, and only when this home records no API. */
const offlineOk = (home: string): boolean => process.versions.bun !== undefined && apiUrl(home) === null;

function route<A>(home: string, api: Effect.Effect<A, ApiFailure>, local: Effect.Effect<A, CliError, SessionsStore>): Effect.Effect<A, CliError, SessionsStore> {
  return api.pipe(
    Effect.catch((e): Effect.Effect<A, CliError, SessionsStore> => {
      if (e._tag === "ApiUnreachable" && offlineOk(home)) return local;
      return Effect.fail(new CliError({ message: e.message, code: 1 }));
    }),
  );
}

/**
 * Register a markdown file as a session (again is fine) and give its URL. Through the API when this
 * home records one; under Bun with none, the registry is written directly.
 */
export function open(
  home: string,
  file: string,
  cwd = process.cwd(),
): Effect.Effect<{ session: Session; url: string }, CliError, SessionsStore> {
  return Effect.gen(function* () {
    const real = yield* Effect.try({ try: () => realDoc(file, cwd), catch: (error) => cliFailure({ message: errorMessage(error) }) });
    const sessions = yield* SessionsStore;
    const api = apiPost(home, "/api/open", { path: real }).pipe(Effect.map((d) => (d as { session: Session }).session));
    const local = sessions.open(home, real, cwd).pipe(Effect.mapError((error) => cliFailure(error)));
    const session = yield* route(home, api, local);
    return { session, url: sessionUrl(session.id) };
  });
}

/** Every registered session with its title, location, branch and open comment count. */
export function sessions(home: string): Effect.Effect<SessionRow[], CliError, SessionsStore> {
  return Effect.gen(function* () {
    const store = yield* SessionsStore;
    const api = apiGet(home, "/api/sessions").pipe(Effect.map((d) => (d as { rows: SessionRow[] }).rows));
    const local = store.rows(home).pipe(Effect.mapError((error) => cliFailure(error)));
    return yield* route(home, api, local);
  });
}

/** Forget a session. Its comments stay, so opening the file again brings them back. */
export function close(home: string, ref: string, cwd = process.cwd()): Effect.Effect<Session, CliError, SessionsStore> {
  return Effect.gen(function* () {
    const store = yield* SessionsStore;
    const { session } = yield* find(home, ref, cwd);
    const api = apiPost(home, "/api/close", { session: session.id }).pipe(Effect.map((d) => (d as { session: Session }).session));
    const local = store.close(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
    return yield* route(home, api, local);
  });
}

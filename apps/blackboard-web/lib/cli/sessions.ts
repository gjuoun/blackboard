import { Pipe, Safe } from "@gjuoun/safe-ts";
import { type ApiFailure, apiGet, apiPost } from "../api-client";
import { apiUrl } from "../api-origin";
import { type CliError, cliFailure, find } from "../cli";
import { errorMessage } from "../errors";
import { realDoc, type Session, type SessionRow, type SessionsStore, toWire } from "../sessions";

const DEFAULT_URL = "http://127.0.0.1:38770";

/** Where the web app shows a session: $BLACKBOARD_URL (default the local app) + /s/<id>. */
export const sessionUrl = (id: string) =>
  `${(process.env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, "")}/s/${id}`;

/** Offline is allowed only under Bun, and only when this home records no API. */
const offlineOk = (home: string): boolean => process.versions.bun !== undefined && apiUrl(home) === null;

const cliError = (message: string): CliError => ({ CliError: { message, code: 1 } });

/** The API when it answers, the local store when it is unreachable and offline is allowed. */
function route<A>(home: string, api: Safe<A, ApiFailure>, local: () => Safe<A, CliError>): Safe<A, CliError> {
  return Safe.try(function* () {
    return (yield Safe.pipe(
      api,
      Pipe.catchTag("ApiUnreachable", (e: { message: string }) =>
        offlineOk(home) ? local() : Safe.err(cliError(e.message)),
      ),
      Pipe.catchTag("ApiRefused", (e: { message: string }) => Safe.err(cliError(e.message))),
    )) as A;
  }) as unknown as Safe<A, CliError>;
}

/**
 * Register a markdown file as a session (again is fine) and give its URL. Through the API when this
 * home records one; under Bun with none, the registry is written directly.
 */
export function open(
  sessions: SessionsStore,
  home: string,
  file: string,
  cwd = process.cwd(),
): Safe<{ session: Session; url: string }, CliError> {
  return Safe.try(function* () {
    const real = (yield Safe.call(
      () => realDoc(file, cwd),
      (error) => cliFailure({ message: errorMessage(error) }),
    )) as string;
    const api = Safe.try(function* () {
      const d = (yield apiPost(home, "/api/open", { path: real })) as { session: Session };
      return d.session;
    }) as unknown as Safe<Session, ApiFailure>;
    const local = () => sessions.open(home, real, cwd) as unknown as Safe<Session, CliError>;
    const session = (yield route(home, api, local)) as Session;
    return { session, url: sessionUrl(session.id) };
  }) as unknown as Safe<{ session: Session; url: string }, CliError>;
}

/** Every registered session with its title, location, branch and open comment count. */
export function list(sessions: SessionsStore, home: string): Safe<Omit<SessionRow, "srcMtime">[], CliError> {
  return Safe.try(function* () {
    const api = Safe.try(function* () {
      const d = (yield apiGet(home, "/api/sessions")) as { rows: Omit<SessionRow, "srcMtime">[] };
      return d.rows;
    }) as unknown as Safe<Omit<SessionRow, "srcMtime">[], ApiFailure>;
    const local = () =>
      Safe.try(function* () {
        const rows = (yield sessions.rows(home)) as SessionRow[];
        return rows.map(toWire);
      }) as unknown as Safe<Omit<SessionRow, "srcMtime">[], CliError>;
    return (yield route(home, api, local)) as Omit<SessionRow, "srcMtime">[];
  }) as unknown as Safe<Omit<SessionRow, "srcMtime">[], CliError>;
}

/** Forget a session. Its comments stay, so opening the file again brings them back. */
export function close(
  sessions: SessionsStore,
  home: string,
  ref: string,
  cwd = process.cwd(),
): Safe<Session, CliError> {
  return Safe.try(function* () {
    const found = (yield find(sessions, home, ref, cwd)) as { session: Session };
    const api = Safe.try(function* () {
      const d = (yield apiPost(home, "/api/close", { session: found.session.id })) as { session: Session };
      return d.session;
    }) as unknown as Safe<Session, ApiFailure>;
    const local = () => sessions.close(home, found.session.id) as unknown as Safe<Session, CliError>;
    return (yield route(home, api, local)) as Session;
  }) as unknown as Safe<Session, CliError>;
}

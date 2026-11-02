import { readFileSync, writeFileSync } from "node:fs";
import { Effect } from "effect";
import { cliFailure, CliError, find } from "../cli";
import type { CommentsStore } from "../comments-store";
import { docMeta } from "../doc-meta";
import { docType } from "../doc-type";
import { ensurePrDoc } from "../pr-kind";
import { prStatus, type PrStatus } from "../pr-status";
import { errorMessage } from "../effect/errors";
import { realDoc, SessionsStore, type Session, type SessionKind, type SessionRow } from "../sessions";
import { StreamStore } from "../stream-store";

const DEFAULT_URL = "http://127.0.0.1:38770";

/** Where the web app shows a session: $BLACKBOARD_URL (default the local app) + /s/<id>. */
export const sessionUrl = (id: string) => `${(process.env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, "")}/s/${id}`;

/** What the CLI pinned, so both the text and --json output can report it. */
export type PrPin = { base: string; sha: string; filled: boolean };

/** Read or write one file as an effect; the failure is the message the CLI prints. */
const readText = (path: string): Effect.Effect<string, CliError> =>
  Effect.try({ try: () => readFileSync(path, "utf8"), catch: (error) => cliFailure({ message: errorMessage(error) }) });

/**
 * Register a markdown file as a session (again is fine) and give its URL. A pr session is
 * verified before it is registered: the front matter must name a hash git can resolve, and a
 * missing block is filled from the merge-base once, then written back into the doc.
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
): Effect.Effect<{ session: Session; url: string; pr?: PrPin }, CliError, SessionsStore | StreamStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const streams = yield* StreamStore;
    const real = yield* Effect.try({ try: () => realDoc(file, cwd), catch: (error) => cliFailure({ message: errorMessage(error) }) });
    const kinded = docType(real, kind ?? "plain");
    if (!kinded.ok) return yield* new CliError({ message: kinded.error, code: 2 });
    let pr: PrPin | undefined;
    if (kind === "pr") {
      const repo = docMeta(real).repo;
      if (!repo) return yield* new CliError({ message: `${real} is not inside a git repository`, code: 1 });
      const src = yield* readText(real);
      const ensured = ensurePrDoc(src, repo.root);
      if (!ensured.ok) return yield* new CliError({ message: ensured.error, code: 1 });
      if (ensured.src !== src) yield* Effect.sync(() => writeFileSync(real, ensured.src));
      pr = { base: ensured.base, sha: ensured.sha, filled: ensured.filled };
    }
    const session = yield* sessions.open(home, real, cwd, kind).pipe(Effect.mapError((error) => cliFailure(error)));
    if ((kind ?? session.kind) === "stream") {
      const title = meta?.title?.trim() || session.id;
      const owner = meta?.owner?.trim();
      yield* streams.create(real, { title, ...(owner ? { owner } : {}) }).pipe(Effect.mapError((error) => cliFailure(error)));
    }
    return { session, url: sessionUrl(session.id), ...(pr ? { pr } : {}) };
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

/** The pinned baseline and the exact diff command for one session; unknown refs fail like any other command. */
export function pr(home: string, ref: string, cwd = process.cwd()): Effect.Effect<PrStatus, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const status = yield* prStatus(home, ref, cwd).pipe(Effect.mapError((error) => cliFailure(error)));
    if (!status) {
      return yield* new CliError({ message: `no session "${ref}" (register the file with: blackboard open <file>)`, code: 1 });
    }
    return status;
  });
}
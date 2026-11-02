import { Effect } from "effect";
import { cliFailure, CliError, find } from "../cli";
import { SessionsStore, type Session } from "../sessions";
import { exportStream, parseStream, type StreamAction } from "../stream-doc";
import { StreamStore, type HeaderResult } from "../stream-store";

/** The stream session and its file, after the kind check. */
function streamFile(
  home: string,
  ref: string,
  cwd: string,
  hint = true,
): Effect.Effect<{ session: Session; file: string }, CliError, SessionsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref, cwd);
    if (session.kind !== "stream") {
      return yield* new CliError({ message: `${session.path} is not a stream${hint ? " (open it with --kind stream)" : ""}`, code: 2 });
    }
    return { session, file: session.path };
  });
}

/** Appends one block to a stream session under the file lock, with a ULID id. */
export function appendBlock(
  home: string,
  ref: string,
  input: { action: string; text: string; author: string; images?: string[]; status?: "writing" },
  cwd = process.cwd(),
): Effect.Effect<{ id: string; n: number; file: string }, CliError, SessionsStore | StreamStore> {
  return Effect.gen(function* () {
    const { session, file } = yield* streamFile(home, ref, cwd);
    const streams = yield* StreamStore;
    if (!input.text.trim()) return yield* new CliError({ message: "block text is empty", code: 2 });
    // A block appended to an empty file writes the metadata line first; the title falls back to the session id.
    const block = yield* streams
      .append(
        file,
        { action: input.action as StreamAction, author: input.author, text: input.text, images: input.images, status: input.status },
        undefined,
        { title: session.id, owner: input.author },
      )
      .pipe(Effect.mapError((error) => cliFailure(error, 2)));
    return { id: block.id, n: block.n, file };
  });
}

/** Replaces the body of one existing block by id. Rewrites the file atomically. */
export function editBlock(
  home: string,
  ref: string,
  id: string,
  text: string,
  cwd = process.cwd(),
): Effect.Effect<{ id: string; n: number; file: string }, CliError, SessionsStore | StreamStore> {
  return Effect.gen(function* () {
    const { file } = yield* streamFile(home, ref, cwd);
    const streams = yield* StreamStore;
    if (!text.trim()) return yield* new CliError({ message: "block text is empty", code: 2 });
    const block = yield* streams.rewrite(file, id, (x) => ({ ...x, body: text, at: new Date().toISOString() })).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
    return { id: block.id, n: block.n, file };
  });
}

/**
 * Add or update the metadata line of an existing stream (old files have none). Every block keeps its
 * place and bytes; the document id and created are kept, so running it twice with the same title is
 * a no-op. This is the migration path for files written before the metadata line existed.
 */
export function setHeader(
  home: string,
  ref: string,
  input: { title: string; owner?: string },
  cwd = process.cwd(),
): Effect.Effect<HeaderResult & { file: string }, CliError, SessionsStore | StreamStore> {
  return Effect.gen(function* () {
    const { session } = yield* streamFile(home, ref, cwd);
    const streams = yield* StreamStore;
    if (!input.title.trim()) return yield* new CliError({ message: "header needs --title <title>", code: 2 });
    const owner = input.owner?.trim();
    const out = yield* streams
      .writeMeta(session.path, { title: input.title.trim(), ...(owner ? { owner } : {}) })
      .pipe(Effect.mapError((error) => cliFailure(error)));
    return { ...out, file: session.path };
  });
}

/** The stream as markdown, one section per block. The cloud mirror reads this export. */
export function exportBlocks(
  home: string,
  ref: string,
  cwd = process.cwd(),
): Effect.Effect<string, CliError, SessionsStore | StreamStore> {
  return Effect.gen(function* () {
    const { session, file } = yield* streamFile(home, ref, cwd, false);
    const streams = yield* StreamStore;
    const sessions = yield* SessionsStore;
    const text = yield* streams.read(file).pipe(Effect.mapError((error) => cliFailure(error)));
    const parsed = parseStream(text);
    // The document own title wins; an old file without a metadata line falls back to the session title.
    const fallback = parsed.meta ? "" : (yield* sessions.row(home, session).pipe(Effect.mapError((error) => cliFailure(error)))).title;
    return exportStream(parsed.blocks, parsed.meta?.title ?? fallback);
  });
}
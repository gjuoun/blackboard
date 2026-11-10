import { statSync } from "node:fs";
import { basename } from "node:path";
import { Effect } from "effect";
import { CommentsStore } from "./comments-store";
import { errorMessage, InvalidInput, IoFailure, sessionNotFound, type ApiFailure } from "./effect/errors";
import { renderMarkdown } from "./markdown";
import {
  countStatuses,
  effectiveEntry,
  markRead,
  markUnread,
  withProgress,
  type PreviewData,
  type PreviewReply,
  type ReadingAction,
  type ReadingResult,
  type WorkspaceData,
  type WorkspaceDoc,
} from "./reading-model";
import { ReadingStateStore } from "./reading-state";
import { relativeTime } from "./relative-time";
import { servablePath, SessionsStore } from "./sessions";

/** The doc file's own mtime, or 0 when it cannot be read: the reading state uses it to spot edits. */
const mtimeOf = (path: string): Effect.Effect<number> =>
  Effect.try({ try: () => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0, catch: () => "unreadable" as const }).pipe(
    Effect.catch(() => Effect.succeed(0)),
  );

/**
 * The inbox: every registered session with its reading state, sorted by last update. One `stat`
 * per document supplies the mtime that decides whether a stored record is still current.
 */
export const workspaceDocs = (
  home: string,
  now = Date.now(),
): Effect.Effect<WorkspaceData, IoFailure | ApiFailure, SessionsStore | ReadingStateStore> =>
  Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const state = yield* ReadingStateStore;
    const rows = yield* sessions.rows(home);
    const file = yield* state.read(home);
    const at = new Date(now).toISOString();
    // The file mtime comes from the row the index wrote, not from a stat: the reading state is current while the
    // file still has the mtime the index read. A missing file reads as 0, as it always has.
    const docs: WorkspaceDoc[] = rows.map((row) => {
      const sourceMtime = row.srcMtime ?? 0;
      const entry = effectiveEntry(file.docs[row.id], sourceMtime, at);
      return {
        id: row.id,
        title: row.title,
        path: row.path,
        location: row.location,
        repo: row.repo?.name ?? null,
        branch: row.branch,
        open: row.open,
        updatedAt: row.updatedAt,
        updated: relativeTime(row.updatedAt, now),
        status: entry.status,
        progress: entry.progress,
      };
    });
    return {
      docs,
      counts: countStatuses(docs),
      pending: docs.reduce((n, doc) => n + doc.open, 0),
      repos: [...new Set(docs.map((doc) => doc.repo).filter((repo): repo is string => repo !== null))].sort(),
    };
  });

/**
 * The preview: the whole document rendered the way the doc page renders it, plus the general
 * comments (the ones with no quoted passage) as the thread under it. Null when the session is
 * gone or its file can no longer be served.
 */
export const previewDoc = (
  home: string,
  id: string,
): Effect.Effect<PreviewData | null, IoFailure | ApiFailure, SessionsStore | CommentsStore> =>
  Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const comments = yield* CommentsStore;
    const session = yield* sessions.get(home, id);
    if (!session) return null;
    const file = servablePath(session);
    if (!file) return null;
    const row = yield* sessions.row(home, session);
    // The markdown comes from the row the index stored. A row not yet indexed has no body to render, and `row()`
    // indexed it a moment ago, so a null here means the file is gone.
    const src = yield* sessions.body(home, id);
    if (src === null) return null;
    const rendered = yield* Effect.tryPromise({
      try: () => renderMarkdown(src, { assetBase: `/api/asset/${id}` }),
      catch: (error) => new IoFailure({ message: errorMessage(error), status: 500 }),
    });
    const commentFile = yield* comments.read(home, id);
    const replies: PreviewReply[] = (commentFile.docs[basename(file)] ?? [])
      .filter((comment) => comment.general)
      .flatMap((comment) => [
        { id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt, updated: relativeTime(comment.createdAt) },
        ...comment.replies.map((reply) => ({ id: reply.id, author: reply.author, body: reply.body, createdAt: reply.createdAt, updated: relativeTime(reply.createdAt) })),
      ]);
    return {
      id,
      title: row.title,
      path: row.path,
      branch: row.branch,
      sections: row.stats.sections,
      diagrams: row.stats.diagrams,
      updated: relativeTime(row.updatedAt),
      html: rendered.html,
      replies,
    };
  });

/** What a workspace write names: one session, or every session for `read-all`. */
export type ReadingInput = { session?: string; action: ReadingAction; progress?: unknown };

const badProgress = () => new InvalidInput({ message: "progress must be a number from 0 to 1", status: 400, field: "progress" });

/**
 * Writes the reading state: mark one document read or unread, record its scroll position, or mark
 * everything read. Every write stamps the document's current mtime, so a later edit invalidates it.
 */
export const applyReading = (
  home: string,
  input: ReadingInput,
): Effect.Effect<ReadingResult, ApiFailure, SessionsStore | ReadingStateStore> =>
  Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const state = yield* ReadingStateStore;
    const at = new Date().toISOString();
    const changed: ReadingResult["docs"] = {};

    if (input.action === "read-all") {
      const all = yield* sessions.list(home);
      const file = yield* state.read(home);
      const entries = yield* Effect.forEach(all, (session) =>
        Effect.map(mtimeOf(session.path), (mtime) => {
          // Each document keeps the position its current record holds (0 when there is none or it
          // is stale): read-all never moves a document, so reopening lands where it was left.
          const prev = effectiveEntry(file.docs[session.id], mtime, at);
          return [session.id, markRead(at, mtime, prev.progress)] as const;
        }),
      );
      yield* Effect.forEach(entries, ([id, entry]) => state.set(home, id, entry));
      for (const [id, entry] of entries) changed[id] = { status: entry.status, progress: entry.progress };
      return { docs: changed };
    }

    if (!input.session) return yield* Effect.fail(sessionNotFound(400));
    const session = yield* sessions.get(home, input.session);
    if (!session) return yield* Effect.fail(sessionNotFound(400));
    if (input.action === "progress" && (typeof input.progress !== "number" || !Number.isFinite(input.progress))) {
      return yield* Effect.fail(badProgress());
    }
    const mtime = yield* mtimeOf(session.path);
    const prevEntry = effectiveEntry((yield* state.read(home)).docs[session.id], mtime, at);
    const entry =
      input.action === "read"
        ? markRead(at, mtime, prevEntry.progress)
        : input.action === "unread"
          ? markUnread(at, mtime)
          : withProgress(input.progress, at, mtime, prevEntry.status);
    yield* state.set(home, session.id, entry);
    return { docs: { [session.id]: { status: entry.status, progress: entry.progress } } };
  });

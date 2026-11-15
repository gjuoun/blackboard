import { Effect, FileSystem } from "effect";
import { apiGet, apiPatch, apiPost, apiUrl, type ApiFailure } from "../api-client";
import { cliFailure, CliError, docOf, find, threadOf, type DocComment } from "../cli";
import { CommentsStore, type CommentFile } from "../comments-store";
import { renderPlainText } from "../markdown";
import { selectorFor } from "../selector";
import { SessionsStore } from "../sessions";

/**
 * The comment commands. Each writes through the API this home records; with no API recorded, a
 * Bun CLI runs the same store call in-process (the offline path). A Node CLI reports the missing
 * API. The API answers rendered `html` next to every comment, which the CLI strips so its output
 * matches the stored shape.
 */

type Stored = Omit<DocComment, "replies"> & { html?: string; replies: (DocComment["replies"][number] & { html?: string })[] };

const plain = (c: Stored): DocComment => {
  const { html: _h, ...rest } = c;
  return { ...rest, replies: rest.replies.map((r) => { const { html: _r, ...kept } = r; return kept; }) } as DocComment;
};

/** Offline is allowed only under Bun, and only when this home records no API. */
const offlineOk = (home: string): boolean => process.versions.bun !== undefined && apiUrl(home) === null;

/** Try the API; when it is unreachable and the offline path applies, run the store call instead. */
function route<A>(
  home: string,
  api: Effect.Effect<A, ApiFailure>,
  local: Effect.Effect<A, CliError, CommentsStore>,
): Effect.Effect<A, CliError, CommentsStore> {
  return api.pipe(
    Effect.catch((e): Effect.Effect<A, CliError, CommentsStore> => {
      if (e._tag === "ApiUnreachable" && offlineOk(home)) return local;
      return Effect.fail(new CliError({ message: e.message, code: 1 }));
    }),
  );
}

/** A store call, with its failures as CLI errors. */
const store = <A>(work: (s: CommentsStore["Service"]) => Effect.Effect<A, { message: string }>): Effect.Effect<A, CliError, CommentsStore> =>
  Effect.gen(function* () {
    const s = yield* CommentsStore;
    return yield* work(s).pipe(Effect.mapError((e) => cliFailure(e)));
  });

/**
 * Every comment in a session with its doc key, read through the API when this home has one. The API
 * answers the doc's comments without their key, so the CLI stamps the doc it resolved.
 */
const listOf = (home: string, sessionId: string, doc: string): Effect.Effect<DocComment[], CliError, CommentsStore> =>
  route(
    home,
    apiGet(home, `/api/comments?session=${encodeURIComponent(sessionId)}`).pipe(
      Effect.map((data) => ((data as { comments?: Stored[] }).comments ?? []).map((c) => ({ ...plain(c), doc }))),
    ),
    store((s) => s.list(home, sessionId)),
  );

/** Every comment in a session, resolved ones included, each with its replies, in creation order. */
export function comments(
  home: string,
  ref: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment[], CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const { session, doc } = yield* find(home, ref, cwd);
    const api = apiGet(home, `/api/comments?session=${encodeURIComponent(session.id)}`).pipe(
      Effect.map((data) => ((data as { comments?: Stored[] }).comments ?? []).map((c) => ({ ...plain(c), doc }))),
    );
    return yield* route(home, api, store((s) => s.list(home, session.id)));
  });
}

/** Close a round for a session doc. The store refuses while an open comment has no agent reply. */
export function review(
  home: string,
  ref: string,
  round: number,
  body: string,
  author: string,
  cwd = process.cwd(),
): Effect.Effect<{ id: string; doc: string; round: number; verdict: "commented" }, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    if (!body.trim()) return yield* new CliError({ message: "review text is empty", code: 2 });
    const { session, doc } = yield* find(home, ref, cwd);
    const api = apiPost(home, "/api/review", { session: session.id, doc, round, body: body.trim(), author }).pipe(
      Effect.map((data) => (data as { review: { id: string; doc: string; round: number; verdict: "commented" } }).review),
    );
    return yield* route(home, api, store((s) => s.review(home, session.id, doc, { round, body: body.trim(), author })));
  });
}

/** An independent comment: no passage. */
export function commentGeneral(
  home: string,
  ref: string,
  note: string,
  author: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    if (!note.trim()) return yield* new CliError({ message: "comment text is empty", code: 2 });
    const { session, doc } = yield* find(home, ref, cwd);
    const body = note.trim();
    const api = apiPost(home, "/api/comments", { session: session.id, general: true, body, author }).pipe(
      Effect.map((data) => ({ ...plain((data as { comment: Stored }).comment), doc })),
    );
    return yield* route(home, api, store((s) => s.add(home, session.id, doc, { general: true, body, author }).pipe(Effect.map((c) => ({ ...c, doc })))));
  });
}

/** Reply to a comment, or to one of its replies: the id names either, the text joins that thread. */
export function reply(
  home: string,
  ref: string,
  id: string,
  body: string,
  author: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    if (!body.trim()) return yield* new CliError({ message: "reply text is empty", code: 2 });
    const { session, doc: sessionDoc } = yield* find(home, ref, cwd);
    const text = body.trim();
    const list = yield* listOf(home, session.id, sessionDoc);
    const { doc, commentId } = yield* threadOf({ version: 1, docs: groupByDoc(list) } as CommentFile, id);
    const api = apiPatch(home, "/api/comments", { session: session.id, id: commentId, action: "reply", body: text, author }).pipe(
      Effect.map((data) => ({ ...plain((data as { comment: Stored }).comment), doc })),
    );
    return yield* route(home, api, store((s) => s.reply(home, commentId, doc, { body: text, author }).pipe(Effect.map((c) => ({ ...c, doc })))));
  });
}

/** Resolve or reopen one comment, by id. */
export function status(
  home: string,
  ref: string,
  id: string,
  to: "resolved" | "open",
  author: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const { session, doc: sessionDoc } = yield* find(home, ref, cwd);
    const list = yield* listOf(home, session.id, sessionDoc);
    const doc = yield* docOf({ version: 1, docs: groupByDoc(list) } as CommentFile, id);
    const action = to === "resolved" ? "resolve" : "reopen";
    const api = apiPatch(home, "/api/comments", { session: session.id, id, action, author }).pipe(
      Effect.map((data) => ({ ...plain((data as { comment: Stored }).comment), doc })),
    );
    return yield* route(home, api, store((s) => s.setStatus(home, id, doc, to, author).pipe(Effect.map((c) => ({ ...c, doc })))));
  });
}

/** Comment on the n-th occurrence of quote in the session doc, as the agent. */
export function comment(
  home: string,
  ref: string,
  quote: string,
  note: string,
  author: string,
  occurrence = 1,
  cwd = process.cwd(),
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (!note.trim()) return yield* new CliError({ message: "comment text is empty", code: 2 });
    const { session, doc } = yield* find(home, ref, cwd);
    const fs = yield* FileSystem.FileSystem;
    const src = yield* fs.readFileString(session.path).pipe(
      Effect.mapError(() => new CliError({ message: `the doc is missing: ${session.path}`, code: 1 })),
    );
    const text = yield* Effect.tryPromise({ try: () => renderPlainText(src), catch: (error) => cliFailure({ message: String(error) }) });
    const sel = selectorFor(text, quote, occurrence);
    if (!sel.ok) return yield* new CliError({ message: sel.error, code: 1 });
    const body = note.trim();
    const api = apiPost(home, "/api/comments", { session: session.id, quote: sel.selector, body, author }).pipe(
      Effect.map((data) => ({ ...plain((data as { comment: Stored }).comment), doc })),
    );
    return yield* route(home, api, store((s) => s.add(home, session.id, doc, { quote: sel.selector, body, author }).pipe(Effect.map((c) => ({ ...c, doc })))));
  });
}

const groupByDoc = (list: DocComment[]): Record<string, DocComment[]> => {
  const docs: Record<string, DocComment[]> = {};
  for (const c of list) (docs[c.doc] ??= []).push(c);
  return docs;
};

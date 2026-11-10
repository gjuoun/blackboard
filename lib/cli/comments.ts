import { Effect, FileSystem } from "effect";
import { cliFailure, CliError, docOf, find, threadOf, type DocComment } from "../cli";
import { CommentsStore } from "../comments-store";
import { renderPlainText } from "../markdown";
import { selectorFor } from "../selector";
import { SessionsStore } from "../sessions";

/** Every comment in a session, resolved ones included, each with its replies, in creation order. */
export function comments(
  home: string,
  ref: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment[], CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    return yield* store.list(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
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
    const store = yield* CommentsStore;
    return yield* store.review(home, session.id, doc, { round, body: body.trim(), author }).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
  });
}

/** An independent comment: no passage. It joins the same store and list as the quoted kind. */
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
    const store = yield* CommentsStore;
    const made = yield* store.add(home, session.id, doc, { general: true, body: note.trim(), author }).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
    return { ...made, doc };
  });
}

/**
 * Reply to a comment, or to one of its replies: id names either, and the text joins that comment
 * flat thread (replies are one flat list per comment). Returns the comment the reply went under.
 */
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
    const { session } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const commentFile = yield* store.read(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
    const { doc, commentId } = yield* threadOf(commentFile, id);
    const made = yield* store
      .reply(home, commentId, doc, { body: body.trim(), author })
      .pipe(Effect.mapError((error) => cliFailure(error)));
    return { ...made, doc };
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
    const { session } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const commentFile = yield* store.read(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
    const doc = yield* docOf(commentFile, id);
    const made = yield* store.setStatus(home, id, doc, to, author).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
    return { ...made, doc };
  });
}

/** Comment on the n-th occurrence of quote in the session doc, as the agent. The page highlights it live. */
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
    const store = yield* CommentsStore;
    const fs = yield* FileSystem.FileSystem;
    const src = yield* fs.readFileString(session.path).pipe(
      Effect.mapError(() => new CliError({ message: `the doc is missing: ${session.path}`, code: 1 })),
    );
    const text = yield* Effect.tryPromise({ try: () => renderPlainText(src), catch: (error) => cliFailure({ message: String(error) }) });
    const sel = selectorFor(text, quote, occurrence);
    if (!sel.ok) return yield* new CliError({ message: sel.error, code: 1 });
    const made = yield* store.add(home, session.id, doc, { quote: sel.selector, body: note.trim(), author }).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
    return { ...made, doc };
  });
}

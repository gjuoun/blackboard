import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { codeStateFromLines, parseCodeRef } from "../code-anchor";
import { cliFailure, CliError, docOf, find, threadOf, type DocComment } from "../cli";
import { addComment, addReply, CommentsStore, reviewRound, setStatus } from "../comments-store";
import { docMeta } from "../doc-meta";
import { renderPlainText } from "../markdown";
import { selectorFor } from "../selector";
import { SessionsStore } from "../sessions";

const linesOfFile = (raw: string): string[] => {
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** One repo file as lines, or null when it cannot be read; the anchor then reads as orphaned. */
const readLines = (path: string): Effect.Effect<readonly string[] | null> =>
  Effect.try({ try: () => linesOfFile(readFileSync(path, "utf8")), catch: () => "unreadable" as const }).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );

/**
 * Every comment in a session, resolved ones included, each with its replies, in creation order.
 * A code anchor also carries its drift state: the anchored file is read once, on demand, so an
 * agent sees the moved line without the anchor ever being rewritten.
 */
export function comments(
  home: string,
  ref: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment[], CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const { session, file } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const commentFile = yield* store.read(file).pipe(Effect.mapError((error) => cliFailure(error)));
    const repo = docMeta(session.path).repo;
    const cache = new Map<string, readonly string[] | null>();
    const out: DocComment[] = [];
    for (const [doc, list] of Object.entries(commentFile.docs)) {
      for (const c of list) {
        if (!c.code || c.code.side !== "new") {
          out.push({ ...c, doc });
          continue;
        }
        const path = repo ? join(repo.root, c.code.path) : null;
        const cached = path === null ? null : cache.get(path);
        const lines = path === null ? null : cached !== undefined ? cached : yield* readLines(path);
        if (path !== null && cached === undefined) cache.set(path, lines);
        out.push({ ...c, doc, codeState: codeStateFromLines(c.code, lines) });
      }
    }
    return out;
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
    const { file, doc } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    return yield* store.mutate(file, (f) => reviewRound(f, doc, { round, body: body.trim(), author })).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
  });
}

/** An independent comment: no passage and no line. It joins the same store and list as the other kinds. */
export function commentGeneral(
  home: string,
  ref: string,
  note: string,
  author: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    if (!note.trim()) return yield* new CliError({ message: "comment text is empty", code: 2 });
    const { file, doc } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const made = yield* store.mutate(file, (f) => addComment(f, doc, { general: true, body: note.trim(), author })).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
    return { ...made, doc };
  });
}

/** Comment on one line of a repo file, n-th line counted from the worktree: lib/a.ts:L12. */
export function commentOnCode(
  home: string,
  ref: string,
  codeRef: string,
  note: string,
  author: string,
  cwd = process.cwd(),
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    if (!note.trim()) return yield* new CliError({ message: "comment text is empty", code: 2 });
    const parsed = parseCodeRef(codeRef);
    if (!parsed) return yield* new CliError({ message: `--code takes <repo-relative-path>:L<n> (got "${codeRef}")`, code: 2 });
    const { session, file, doc } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const repo = docMeta(session.path).repo;
    if (!repo) return yield* new CliError({ message: `${session.path} is not inside a git repository`, code: 1 });
    const lines = yield* readLines(join(repo.root, parsed.path));
    if (!lines) return yield* new CliError({ message: `no such file in ${repo.name}: ${parsed.path}`, code: 1 });
    const lineText = lines[parsed.start - 1];
    if (lineText === undefined) return yield* new CliError({ message: `${parsed.path} has no line ${parsed.start}`, code: 1 });
    if (parsed.end > lines.length) return yield* new CliError({ message: `${parsed.path} has no line ${parsed.end}`, code: 1 });
    const code = { path: parsed.path, startLine: parsed.start, endLine: parsed.end, side: "new" as const, lineText };
    const made = yield* store.mutate(file, (f) => addComment(f, doc, { code, body: note.trim(), author })).pipe(
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
    const { file } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const commentFile = yield* store.read(file).pipe(Effect.mapError((error) => cliFailure(error)));
    const { doc, commentId } = yield* threadOf(commentFile, id);
    const made = yield* store
      .mutate(file, (f) => addReply(f, doc, commentId, { body: body.trim(), author }))
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
    const { file } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const commentFile = yield* store.read(file).pipe(Effect.mapError((error) => cliFailure(error)));
    const doc = yield* docOf(commentFile, id);
    const made = yield* store.mutate(file, (f) => setStatus(f, doc, id, to, author)).pipe(
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
): Effect.Effect<DocComment, CliError, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    if (!note.trim()) return yield* new CliError({ message: "comment text is empty", code: 2 });
    const { session, file, doc } = yield* find(home, ref, cwd);
    const store = yield* CommentsStore;
    const src = yield* Effect.try({
      try: () => readFileSync(session.path, "utf8"),
      catch: () => new CliError({ message: `the doc is missing: ${session.path}`, code: 1 }),
    });
    const text = yield* Effect.tryPromise({ try: () => renderPlainText(src), catch: (error) => cliFailure({ message: String(error) }) });
    const sel = selectorFor(text, quote, occurrence);
    if (!sel.ok) return yield* new CliError({ message: sel.error, code: 1 });
    const made = yield* store.mutate(file, (f) => addComment(f, doc, { quote: sel.selector, body: note.trim(), author })).pipe(
      Effect.mapError((error) => cliFailure(error)),
    );
    return { ...made, doc };
  });
}
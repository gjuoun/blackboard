import { basename } from "node:path";
import { Data, Effect } from "effect";
import { type Comment, type CommentFile } from "./comments-store";
import { SessionsStore, sessionCommentsPath, type Session, type SessionRow } from "./sessions";
import type { PrStatus } from "./pr-status";

/** A failure the CLI reports on stderr. code 1 = the command failed, 2 = bad usage. */
export class CliError extends Data.TaggedError("CliError")<{ message: string; code: 1 | 2 }> {}

/** A store or parsing failure as the CLI reports it: same message, exit code 1 unless given. */
export const cliFailure = (error: { message: string }, code: 1 | 2 = 1) => new CliError({ message: error.message, code });

export type DocComment = Comment & { doc: string };

/** A session and the comment file its comments live in, resolved from an id or a path. */
export type Target = { session: Session; file: string; doc: string };

/** A session named by id or by a path to its file (relative to cwd). */
export function find(home: string, ref: string, cwd = process.cwd()): Effect.Effect<Target, CliError, SessionsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const session = yield* sessions.resolve(home, ref, cwd).pipe(Effect.mapError((error) => cliFailure(error)));
    if (!session) {
      return yield* new CliError({ message: `no session "${ref}" (register the file with: blackboard open <file>)`, code: 1 });
    }
    return { session, file: sessionCommentsPath(home, session.id), doc: basename(session.path) };
  });
}

/** The top-level comment that id is, or that holds id as one of its replies. Ids are unique within a session. */
export function threadOf(file: CommentFile, id: string): Effect.Effect<{ doc: string; commentId: string }, CliError> {
  return Effect.suspend(() => {
    for (const [doc, list] of Object.entries(file.docs)) {
      const c = list.find((x) => x.id === id || x.replies.some((r) => r.id === id));
      if (c) return Effect.succeed({ doc, commentId: c.id });
    }
    return Effect.fail(new CliError({ message: `no comment ${id} on this session`, code: 1 }));
  });
}

/** Comment ids are unique within a session, so a command can name a comment by id alone. */
export function docOf(file: CommentFile, id: string): Effect.Effect<string, CliError> {
  return Effect.suspend(() => {
    const doc = Object.keys(file.docs).find((d) => file.docs[d].some((c) => c.id === id));
    return doc ? Effect.succeed(doc) : Effect.fail(new CliError({ message: `no comment ${id} on this session`, code: 1 }));
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Human-readable thread tree: each comment with its id, doc, status, author and time, its quote and
 * note, then its replies indented under it. Each reply shows its id, so it can be answered in turn.
 */
export function formatComments(list: DocComment[]): string {
  if (list.length === 0) return "no comments";
  return list
    .map((c) => {
      const where = c.quote ? "  > " + squash(c.quote.exact) : "  (general)";
      const lines = [`${c.id}  ${c.doc}  ${c.status}  ${c.author}  ${c.createdAt}`, where, `  ${c.body.replace(/\n/g, "\n  ")}`];
      for (const r of c.replies) lines.push(`    \u21b3 ${r.id}  ${r.author}: ${r.body.replace(/\n/g, "\n      ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Human form of a session pr state: the front matter baseline and the command to run. */
export function formatPr(status: PrStatus): string {
  const lines = [`${status.session}  ${status.path}  ${status.kind}`];
  if (status.base && status.command) {
    const totals = status.totals ?? { files: 0, additions: 0, deletions: 0 };
    lines.push(`base ${status.base.ref} @ ${status.base.sha}`, status.command);
    lines.push(`${totals.files} files  +${totals.additions} -${totals.deletions}  ${status.comments.open} open`);
  } else {
    lines.push("no pinned base: open the doc with --kind pr");
  }
  return lines.join("\n");
}

/** One line per session: id, title, where it is, branch, open comments, kind. */
export function formatSessions(rows: SessionRow[]): string {
  if (rows.length === 0) return "no sessions (register a file with: blackboard open <file>)";
  return rows
    .map((r) => `${r.id}  ${r.title}  ${r.location}  ${r.branch ?? "-"}  ${r.open} open  ${r.kind ?? "plain"}${r.missing ? "  (missing)" : ""}`)
    .join("\n");
}
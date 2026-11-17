import { Safe } from "@gjuoun/safe-ts";
import type { Comment, CommentFile } from "./comments-store";
import { docKey } from "./session-model";
import type { Session, SessionRow, SessionsStore } from "./sessions";

/** A failure the CLI reports on stderr. code 1 = the command failed, 2 = bad usage. */
export type CliError = { readonly CliError: { readonly message: string; readonly code: 1 | 2 } };

const cliError = (message: string, code: 1 | 2 = 1): CliError => ({ CliError: { message, code } });

/** A store or parsing failure as the CLI reports it: same message, exit code 1 unless given. */
export const cliFailure = (error: { message: string }, code: 1 | 2 = 1): CliError =>
  cliError(error.message, code);

export type DocComment = Comment & { doc: string };

/** A session and the comment file its comments live in, resolved from an id or a path. */
export type Target = { session: Session; doc: string };

/** A session named by id or by a path to its file (relative to cwd). */
export function find(
  sessions: SessionsStore,
  home: string,
  ref: string,
  cwd = process.cwd(),
): Safe<Target, CliError> {
  return Safe.try(function* () {
    const session = (yield sessions.resolve(home, ref, cwd)) as Session | null;
    if (!session)
      return (yield Safe.err(
        cliError(`no session "${ref}" (register the file with: blackboard open <file>)`),
      )) as never;
    return { session, doc: docKey(session) };
  }) as unknown as Safe<Target, CliError>;
}

/** The top-level comment that id is, or that holds id as one of its replies. Ids are unique within a session. */
export function threadOf(file: CommentFile, id: string): Safe<{ doc: string; commentId: string }, CliError> {
  for (const [doc, list] of Object.entries(file.docs)) {
    const c = list.find((x) => x.id === id || x.replies.some((r) => r.id === id));
    if (c) return Safe.ok({ doc, commentId: c.id });
  }
  return Safe.err(cliError(`no comment ${id} on this session`));
}

/** Comment ids are unique within a session, so a command can name a comment by id alone. */
export function docOf(file: CommentFile, id: string): Safe<string, CliError> {
  const doc = Object.keys(file.docs).find((d) => file.docs[d].some((c) => c.id === id));
  return doc ? Safe.ok(doc) : Safe.err(cliError(`no comment ${id} on this session`));
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
      const lines = [
        `${c.id}  ${c.doc}  ${c.status}  ${c.author}  ${c.createdAt}`,
        where,
        `  ${c.body.replace(/\n/g, "\n  ")}`,
      ];
      for (const r of c.replies)
        lines.push(`    \u21b3 ${r.id}  ${r.author}: ${r.body.replace(/\n/g, "\n      ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** One line per session: id, title, where it is, branch, open comments. */
export function formatSessions(rows: Omit<SessionRow, "srcMtime">[]): string {
  if (rows.length === 0) return "no sessions (register a file with: blackboard open <file>)";
  return rows
    .map(
      (r) =>
        `${r.id}  ${r.title}  ${r.location}  ${r.branch ?? "-"}  ${r.open} open${r.missing ? "  (missing)" : ""}`,
    )
    .join("\n");
}

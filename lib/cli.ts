import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { addComment, addReply, mutate, readComments, setStatus, type Comment, type CommentFile } from "./comments-store";
import { renderPlainText } from "./markdown";
import { selectorFor } from "./selector";
import { closeSession, openSession, resolveSession, SessionError, sessionCommentsPath, sessionRows, type Session, type SessionRow } from "./sessions";

/** A failure the CLI reports on stderr. code 1 = the command failed, 2 = bad usage. */
export class CliError extends Error {
  constructor(message: string, readonly code: 1 | 2 = 1) {
    super(message);
  }
}

export type DocComment = Comment & { doc: string };

const DEFAULT_URL = "http://127.0.0.1:38770";

/** Where the web app shows a session: $BLACKBOARD_URL (default the local app) + /s/<id>. */
export const sessionUrl = (id: string) => `${(process.env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, "")}/s/${id}`;

/** A session named by id or by a path to its file (relative to `cwd`). */
function find(home: string, ref: string, cwd = process.cwd()): { session: Session; file: string; doc: string } {
  const session = resolveSession(home, ref, cwd);
  if (!session) throw new CliError(`no session "${ref}" (register the file with: blackboard open <file>)`);
  return { session, file: sessionCommentsPath(home, session.id), doc: basename(session.path) };
}

/** The top-level comment that `id` is, or that holds `id` as one of its replies. Ids are unique within a session. */
function threadOf(file: CommentFile, id: string): { doc: string; commentId: string } {
  for (const [doc, list] of Object.entries(file.docs)) {
    const c = list.find((x) => x.id === id || x.replies.some((r) => r.id === id));
    if (c) return { doc, commentId: c.id };
  }
  throw new CliError(`no comment ${id} on this session`);
}

/** Comment ids are unique within a session, so a command can name a comment by id alone. */
function docOf(file: CommentFile, id: string): string {
  const doc = Object.keys(file.docs).find((d) => file.docs[d].some((c) => c.id === id));
  if (!doc) throw new CliError(`no comment ${id} on this session`);
  return doc;
}

/** Register a markdown file as a session (again is fine) and give its URL. */
export function open(home: string, file: string, cwd = process.cwd()): { session: Session; url: string } {
  try {
    const session = openSession(home, file, cwd);
    return { session, url: sessionUrl(session.id) };
  } catch (err) {
    if (err instanceof SessionError) throw new CliError(err.message);
    throw err;
  }
}

export function sessions(home: string): SessionRow[] {
  return sessionRows(home);
}

export function close(home: string, ref: string, cwd = process.cwd()): Session {
  return closeSession(home, find(home, ref, cwd).session.id);
}

/** Every comment in a session, resolved ones included, each with its replies, in creation order. */
export function comments(home: string, ref: string, cwd = process.cwd()): DocComment[] {
  const { file } = find(home, ref, cwd);
  return Object.entries(readComments(file).docs).flatMap(([doc, list]) => list.map((c) => ({ ...c, doc })));
}

/**
 * Reply to a comment, or to one of its replies: `id` names either, and the text joins that comment's
 * thread (replies are one flat list per comment). Returns the comment the reply went under.
 */
export async function reply(home: string, ref: string, id: string, body: string, author: string, cwd = process.cwd()): Promise<DocComment> {
  if (!body.trim()) throw new CliError("reply text is empty", 2);
  const { file } = find(home, ref, cwd);
  const { doc, commentId } = threadOf(readComments(file), id);
  return { ...(await mutate(file, (f) => addReply(f, doc, commentId, { body: body.trim(), author }))), doc };
}

export async function status(home: string, ref: string, id: string, to: "resolved" | "open", author: string, cwd = process.cwd()): Promise<DocComment> {
  const { file } = find(home, ref, cwd);
  const doc = docOf(readComments(file), id);
  return { ...(await mutate(file, (f) => setStatus(f, doc, id, to, author))), doc };
}

/** Comment on the n-th occurrence of `quote` in the session's doc, as the agent. The page highlights it live. */
export async function comment(
  home: string,
  ref: string,
  quote: string,
  note: string,
  author: string,
  occurrence = 1,
  cwd = process.cwd(),
): Promise<DocComment> {
  if (!note.trim()) throw new CliError("comment text is empty", 2);
  const { session, file, doc } = find(home, ref, cwd);
  let src: string;
  try {
    src = readFileSync(session.path, "utf8");
  } catch {
    throw new CliError(`the doc is missing: ${session.path}`);
  }
  const sel = selectorFor(await renderPlainText(src), quote, occurrence);
  if (!sel.ok) throw new CliError(sel.error);
  return { ...(await mutate(file, (f) => addComment(f, doc, { quote: sel.selector, body: note.trim(), author }))), doc };
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
      const lines = [`${c.id}  ${c.doc}  ${c.status}  ${c.author}  ${c.createdAt}`, `  > ${squash(c.quote.exact)}`, `  ${c.body.replace(/\n/g, "\n  ")}`];
      for (const r of c.replies) lines.push(`    ↳ ${r.id}  ${r.author}: ${r.body.replace(/\n/g, "\n      ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** One line per session: id, title, where it is, branch, open comments. */
export function formatSessions(rows: SessionRow[]): string {
  if (rows.length === 0) return "no sessions (register a file with: blackboard open <file>)";
  return rows
    .map((r) => `${r.id}  ${r.title}  ${r.location}  ${r.branch ?? "-"}  ${r.open} open${r.missing ? "  (missing)" : ""}`)
    .join("\n");
}

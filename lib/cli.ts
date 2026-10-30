import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { anchorLabel, codeStateFromLines, parseCodeRef, type CodeState } from "./code-anchor";
import { addComment, addReply, mutate, readComments, setStatus, type Comment, type CommentFile } from "./comments-store";
import { docMeta } from "./doc-meta";
import { renderPlainText } from "./markdown";
import { selectorFor } from "./selector";
import { closeSession, openSession, resolveSession, SessionError, sessionCommentsPath, sessionRows, type Session, type SessionRow } from "./sessions";

/** A failure the CLI reports on stderr. code 1 = the command failed, 2 = bad usage. */
export class CliError extends Error {
  constructor(message: string, readonly code: 1 | 2 = 1) {
    super(message);
  }
}

export type DocComment = Comment & { doc: string; codeState?: CodeState };

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

const linesOfFile = (raw: string): string[] => {
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/**
 * Every comment in a session, resolved ones included, each with its replies, in creation order.
 * A code anchor also carries its drift state: the anchored file is read once, on demand, so an
 * agent sees `L12 ↦ 现 L14` without the anchor ever being rewritten.
 */
export function comments(home: string, ref: string, cwd = process.cwd()): DocComment[] {
  const { session, file } = find(home, ref, cwd);
  const repo = docMeta(session.path).repo;
  const cache = new Map<string, readonly string[] | null>();
  const read = (path: string): readonly string[] | null => {
    if (!repo) return null;
    const hit = cache.get(path);
    if (hit !== undefined) return hit;
    let lines: readonly string[] | null = null;
    try {
      lines = linesOfFile(readFileSync(join(repo.root, path), "utf8"));
    } catch {
      lines = null;
    }
    cache.set(path, lines);
    return lines;
  };
  return Object.entries(readComments(file).docs).flatMap(([doc, list]) =>
    list.map((c) => ({
      ...c,
      doc,
      ...(c.code && c.code.side === "new" ? { codeState: codeStateFromLines(c.code, read(c.code.path)) } : {}),
    })),
  );
}

/** Comment on one line of a repo file, n-th line counted from the worktree: `lib/a.ts:L12`. */
export async function commentOnCode(
  home: string,
  ref: string,
  codeRef: string,
  note: string,
  author: string,
  cwd = process.cwd(),
): Promise<DocComment> {
  if (!note.trim()) throw new CliError("comment text is empty", 2);
  const parsed = parseCodeRef(codeRef);
  if (!parsed) throw new CliError(`--code takes <repo-relative-path>:L<n> (got "${codeRef}")`, 2);
  const { session, file, doc } = find(home, ref, cwd);
  const repo = docMeta(session.path).repo;
  if (!repo) throw new CliError(`${session.path} is not inside a git repository`);
  let lines: string[];
  try {
    lines = linesOfFile(readFileSync(join(repo.root, parsed.path), "utf8"));
  } catch {
    throw new CliError(`no such file in ${repo.name}: ${parsed.path}`);
  }
  const lineText = lines[parsed.start - 1];
  if (lineText === undefined) throw new CliError(`${parsed.path} has no line ${parsed.start}`);
  if (parsed.end > lines.length) throw new CliError(`${parsed.path} has no line ${parsed.end}`);
  const code = { path: parsed.path, startLine: parsed.start, endLine: parsed.end, side: "new" as const, lineText };
  return { ...(await mutate(file, (f) => addComment(f, doc, { code, body: note.trim(), author }))), doc };
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
      const drift = c.codeState
        ? c.codeState.orphaned
          ? c.codeState.movedTo
            ? ` \u21a6 \u73b0 L${c.codeState.movedTo}`
            : "  (line drifted)"
          : ""
        : "";
      const where = c.quote ? "  > " + squash(c.quote.exact) : `  @ ${anchorLabel(c.code!)}` + drift;
      const lines = [`${c.id}  ${c.doc}  ${c.status}  ${c.author}  ${c.createdAt}`, where, `  ${c.body.replace(/\n/g, "\n  ")}`];
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

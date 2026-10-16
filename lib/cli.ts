import { readFileSync, watch, type FSWatcher } from "node:fs";
import { activitySince, type Activity } from "./activity";
import { listBoards, resolveBoard, resolveDoc, type Board } from "./boards";
import { addComment, addReply, commentsPath, mutate, readComments, setStatus, type Comment, type CommentFile } from "./comments-store";
import { renderPlainText } from "./markdown";
import { selectorFor } from "./selector";

/** A failure the CLI reports on stderr. code 1 = the command failed, 2 = bad usage. */
export class CliError extends Error {
  constructor(message: string, readonly code: 1 | 2 = 1) {
    super(message);
  }
}

export type DocComment = Comment & { doc: string };

function board(root: string, name: string): string {
  const dir = resolveBoard(root, name);
  if (!dir) throw new CliError(`no board "${name}" under ${root}`);
  return dir;
}

/** Comment ids are unique within a board, so a command can name a comment without its doc. */
function docOf(file: CommentFile, id: string): string {
  const doc = Object.keys(file.docs).find((d) => file.docs[d].some((c) => c.id === id));
  if (!doc) throw new CliError(`no comment ${id} on this board`);
  return doc;
}

export function boards(root: string): Board[] {
  return listBoards(root);
}

/** Comments on a board (or one doc), open only unless `all`, in doc order then creation order. */
export function comments(root: string, name: string, opts: { doc?: string; all?: boolean } = {}): DocComment[] {
  const file = readComments(commentsPath(board(root, name)));
  return Object.entries(file.docs)
    .filter(([doc]) => !opts.doc || doc === opts.doc)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([doc, list]) => list.map((c) => ({ ...c, doc })))
    .filter((c) => opts.all || c.status === "open");
}

export async function reply(root: string, name: string, id: string, body: string, author: string): Promise<DocComment> {
  if (!body.trim()) throw new CliError("reply text is empty", 2);
  const dir = board(root, name);
  const doc = docOf(readComments(commentsPath(dir)), id);
  return { ...(await mutate(commentsPath(dir), (f) => addReply(f, doc, id, { body: body.trim(), author }))), doc };
}

export async function status(root: string, name: string, id: string, to: "resolved" | "open", author: string): Promise<DocComment> {
  const dir = board(root, name);
  const doc = docOf(readComments(commentsPath(dir)), id);
  return { ...(await mutate(commentsPath(dir), (f) => setStatus(f, doc, id, to, author))), doc };
}

/** Comment on the n-th occurrence of `quote` in a doc, as the agent. The page highlights it live. */
export async function comment(
  root: string,
  name: string,
  doc: string,
  quote: string,
  note: string,
  author: string,
  occurrence = 1,
): Promise<DocComment> {
  if (!note.trim()) throw new CliError("comment text is empty", 2);
  const dir = board(root, name);
  const file = resolveDoc(root, name, doc);
  if (!file) throw new CliError(`no doc "${doc}" on board "${name}"`);
  const sel = selectorFor(await renderPlainText(readFileSync(file, "utf8")), quote, occurrence);
  if (!sel.ok) throw new CliError(sel.error);
  return { ...(await mutate(commentsPath(dir), (f) => addComment(f, doc, { quote: sel.selector, body: note.trim(), author }))), doc };
}

/** "90s", "30m", "2h" or plain milliseconds. */
export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(s.trim());
  if (!m) throw new CliError(`bad duration "${s}" (use e.g. 90s, 30m, 2h)`, 2);
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(m[2] ?? "ms") as "ms" | "s" | "m" | "h"];
}

export type WaitResult = { events: Activity[]; next: string; timedOut: boolean };

/**
 * Block until someone other than `me` comments, replies, edits, reopens or resolves on the board
 * after `since` (default: now), or until the timeout. Watches the board folder and also polls every
 * 2 s, so a missed file event only costs latency.
 */
export function waitForActivity(root: string, name: string, opts: { since?: string; timeoutMs: number; me: string }): Promise<WaitResult> {
  const dir = board(root, name);
  const since = opts.since ? new Date(opts.since).toISOString() : new Date().toISOString();
  if (since === "Invalid Date") throw new CliError(`bad --since "${opts.since}"`, 2);
  return new Promise((resolve) => {
    let watcher: FSWatcher | null = null;
    const finish = (r: WaitResult) => {
      watcher?.close();
      clearInterval(poll);
      clearTimeout(timer);
      resolve(r);
    };
    const check = () => {
      let found;
      try {
        found = activitySince(readComments(commentsPath(dir)), since, opts.me);
      } catch {
        return; // unreadable for a moment: try again on the next event or poll
      }
      if (found.events.length > 0) finish({ ...found, timedOut: false });
    };
    const poll = setInterval(check, 2000);
    const timer = setTimeout(() => finish({ events: [], next: since, timedOut: true }), opts.timeoutMs);
    try {
      watcher = watch(dir, { recursive: true }, (_e, f) => {
        if (f && String(f).startsWith(".blackboard")) check();
      });
    } catch {
      // polling still runs
    }
    check();
  });
}

export function formatActivity(r: WaitResult): string {
  const lines = r.events.map((e) => `${e.at}  ${e.kind}  ${e.doc}  ${e.commentId}  ${e.author}\n  > ${e.quote}\n  ${e.body.replace(/\n/g, "\n  ")}`);
  return [...lines, `next: ${r.next}`].join("\n\n");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Human-readable listing: id, doc, status, author and time, then the quote, note and replies. */
export function formatComments(list: DocComment[]): string {
  if (list.length === 0) return "no comments";
  return list
    .map((c) => {
      const lines = [`${c.id}  ${c.doc}  ${c.status}  ${c.author}  ${c.createdAt}`, `  > ${squash(c.quote.exact)}`, `  ${c.body.replace(/\n/g, "\n  ")}`];
      for (const r of c.replies) lines.push(`    ↳ ${r.author}: ${r.body.replace(/\n/g, "\n      ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

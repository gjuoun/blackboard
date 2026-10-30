import type { Comment, Reply } from "./comments-store";
import type { DiffSnapshot } from "./diff-index";
import { normalizeRepoPath } from "./repo-path";

/**
 * A comment anchored to one line of the Local PR diff. It is the second anchor kind next to the
 * passage selector: the same comment file, the same CLI, no migration. `lineText` is the anchored
 * line exactly as it read when the comment was written, so a drifted line can be detected instead
 * of guessed at.
 */
export type CodeAnchor = {
  path: string;
  startLine: number;
  endLine: number;
  side: "new" | "old";
  lineText: string;
};

/** The row id the snippet renders for an anchor: `L12` on the new side, `Lold34` on the old side. */
export function rowKey(anchor: Pick<CodeAnchor, "side" | "startLine">): string {
  return (anchor.side === "old" ? "Lold" : "L") + anchor.startLine;
}

/** How an anchor reads in the CLI and the Comments tab: `residency.ts:L12`. */
export const anchorLabel = (anchor: CodeAnchor): string => anchor.path + ":" + rowKey(anchor);

/** The line text is user content, but it is shipped in HTML and JSON: keep it bounded and NUL-free. */
export const MAX_LINE_TEXT = 4000;

const lineNo = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

/** Validate a code anchor from an untrusted body. Null means "not a usable anchor". */
export function normalizeCodeAnchor(input: unknown): CodeAnchor | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  const path = typeof v.path === "string" ? normalizeRepoPath(v.path) : null;
  if (!path) return null;
  if (!lineNo(v.startLine)) return null;
  const endLine = v.endLine === undefined ? v.startLine : v.endLine;
  if (!lineNo(endLine) || endLine < v.startLine) return null;
  const side = v.side === undefined ? "new" : v.side;
  if (side !== "new" && side !== "old") return null;
  const text = v.lineText;
  if (typeof text !== "string" || text.length > MAX_LINE_TEXT || text.includes("\0")) return null;
  return { path, startLine: v.startLine, endLine, side, lineText: text };
}

export type CodeState = { orphaned: boolean; movedTo: number | null };

/** Parse a `path:L12` (or `path:L12-L14`) reference, as the CLI takes it. Null means unusable. */
export function parseCodeRef(ref: string): { path: string; start: number; end: number } | null {
  const m = /^(.+?):L(\d+)(?:-L?(\d+))?$/.exec(ref.trim());
  if (!m) return null;
  const path = normalizeRepoPath(m[1]);
  const start = Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  if (!path || !Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start) return null;
  return { path, start, end };
}

const INTACT: CodeState = { orphaned: false, movedTo: null };

/**
 * The anchored line as the snapshot has it now: the worktree line on the new side, the deleted hunk
 * line on the old side. Every answer comes from the request's snapshot, never from git or disk here.
 */
export function currentLine(anchor: CodeAnchor, snapshot: DiffSnapshot): string | null {
  if (anchor.side === "old") {
    const file = snapshot.file(anchor.path);
    if (!file) return null;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "del" && line.oldLine === anchor.startLine) return line.text;
      }
    }
    return null;
  }
  const lines = snapshot.content(anchor.path);
  return lines ? (lines[anchor.startLine - 1] ?? null) : null;
}

/**
 * Whether the anchored line still reads as it did. A drift is reported, never repaired: `movedTo`
 * names the one line that now holds the stored text, and stays null when the text is gone or appears
 * more than once — the renderer must not guess a position.
 */
export function codeStateFromLines(anchor: CodeAnchor, lines: readonly string[] | null): CodeState {
  if (!lines) return { orphaned: true, movedTo: null };
  if (lines[anchor.startLine - 1] === anchor.lineText) return INTACT;
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === anchor.lineText) hits.push(i + 1);
  }
  return { orphaned: true, movedTo: hits.length === 1 ? hits[0] : null };
}

/** The state a new-side anchor has in a snapshot; the old side is checked against the hunk. */
export function codeState(anchor: CodeAnchor, snapshot: DiffSnapshot): CodeState {
  if (anchor.side === "old") return currentLine(anchor, snapshot) === anchor.lineText ? INTACT : { orphaned: true, movedTo: null };
  return codeStateFromLines(anchor, snapshot.content(anchor.path));
}

/** A rendered comment or reply, as the snippet renders it inside a thread. */
export type CodeThreadEntry = { id: string; author: string; createdAt: string; html: string; body: string; reply: boolean };

/** One comment and its replies, ready to render as a diff-box thread. */
export type CodeThread = CodeState & {
  id: string;
  anchor: CodeAnchor;
  author: string;
  createdAt: string;
  status: "open" | "resolved";
  /** The comment plus its replies: the count the anchor row shows, as in the mock. */
  count: number;
  entries: CodeThreadEntry[];
};

export type RenderedThreadComment = Omit<Comment, "replies"> & { html: string; replies: (Reply & { html: string })[] };
export type CodeThreads = {
  byRow: Map<string, CodeThread[]>;
  /** Per comment id, for the Comments tab's anchor chip and orphan note. */
  state: Record<string, CodeState>;
};

/** A thread is addressed by its file and row, because two files can both have an `L12`. */
export const threadKey = (path: string, key: string): string => path + "\u0000" + key;

/**
 * Group the request's rendered comments into diff-box threads. The anchor state is resolved once
 * per comment against the request snapshot; nothing here reads git or the filesystem.
 */
export function groupCodeThreads(comments: RenderedThreadComment[], snapshot: DiffSnapshot | null): CodeThreads {
  const byRow = new Map<string, CodeThread[]>();
  const state: Record<string, CodeState> = {};
  for (const c of comments) {
    if (!c.code) continue;
    const s = snapshot ? codeState(c.code, snapshot) : { orphaned: false, movedTo: null };
    state[c.id] = s;
    const thread: CodeThread = {
      id: c.id,
      anchor: c.code,
      author: c.author,
      createdAt: c.createdAt,
      status: c.status,
      ...s,
      count: 1 + c.replies.length,
      entries: [
        { id: c.id, author: c.author, createdAt: c.createdAt, html: c.html, body: c.body, reply: false },
        ...c.replies.map((r) => ({ id: r.id, author: r.author, createdAt: r.createdAt, html: r.html, body: r.body, reply: true })),
      ],
    };
    const key = threadKey(c.code.path, rowKey(c.code));
    const list = byRow.get(key);
    if (list) list.push(thread);
    else byRow.set(key, [thread]);
  }
  for (const list of byRow.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { byRow, state };
}

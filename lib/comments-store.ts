import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { QuoteSelector } from "./anchor";
import { withFileLock } from "./lock";
import { resolveSafe } from "./paths";

/**
 * On-disk format of a comment file. Plain JSON on purpose: an agent reads it straight from
 * disk. Keys of `docs` name the doc the comments belong to.
 */
export type Reply = { id: string; body: string; author: string; createdAt: string; editedAt?: string };
export type CommentStatus = "open" | "resolved";
export type Comment = {
  id: string;
  quote: QuoteSelector;
  body: string;
  author: string;
  createdAt: string;
  editedAt?: string;
  status: CommentStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  replies: Reply[];
};
export type CommentFile = { version: 1; docs: Record<string, Comment[]> };

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

export function commentsPath(boardDir: string): string {
  const p = resolveSafe(boardDir, ".blackboard/comments.json");
  if (!p) throw new Error("comment file path leaves the board");
  return p;
}

/** The comments in a comment file; empty when the file does not exist. A file that does not parse is an error, never silently replaced. */
export function readComments(p: string): CommentFile {
  if (!existsSync(p)) return { version: 1, docs: {} };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || typeof data.docs !== "object") throw new Error(`unsupported comment file: ${p}`);
  return data as CommentFile;
}

function writeAtomic(p: string, data: CommentFile) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, p);
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Read, change and write a comment file. Calls in this process are queued, and every
 * process (web app, CLI) holds the file lock for the read-change-write, so no writer loses another's
 * change. The write goes to a temp file renamed over the old one.
 */
export function mutate<T>(p: string, change: (file: CommentFile) => T): Promise<T> {
  const run = (queues.get(p) ?? Promise.resolve()).catch(() => {}).then(() => {
    mkdirSync(dirname(p), { recursive: true });
    return withFileLock(p, () => {
      const file = readComments(p);
      const result = change(file);
      writeAtomic(p, file);
      return result;
    });
  });
  queues.set(p, run);
  return run;
}

function find(file: CommentFile, doc: string, id: string): Comment {
  const c = file.docs[doc]?.find((x) => x.id === id);
  if (!c) throw new Error(`comment ${id} not found in ${doc}`);
  return c;
}

export function addComment(file: CommentFile, doc: string, input: { quote: QuoteSelector; body: string; author: string }): Comment {
  const c: Comment = { id: newId("c"), quote: input.quote, body: input.body, author: input.author, createdAt: now(), status: "open", replies: [] };
  (file.docs[doc] ??= []).push(c);
  return c;
}

export function addReply(file: CommentFile, doc: string, id: string, input: { body: string; author: string }): Comment {
  const c = find(file, doc, id);
  c.replies.push({ id: newId("r"), body: input.body, author: input.author, createdAt: now() });
  return c;
}

export function editComment(file: CommentFile, doc: string, id: string, body: string): Comment {
  const c = find(file, doc, id);
  c.body = body;
  c.editedAt = now();
  return c;
}

/** Removes the comment and its replies. Returns the removed comment. */
export function deleteComment(file: CommentFile, doc: string, id: string): Comment {
  const c = find(file, doc, id);
  file.docs[doc] = file.docs[doc].filter((x) => x.id !== id);
  if (file.docs[doc].length === 0) delete file.docs[doc];
  return c;
}

function findReply(c: Comment, replyId: string): Reply {
  const r = c.replies.find((x) => x.id === replyId);
  if (!r) throw new Error(`reply ${replyId} not found on ${c.id}`);
  return r;
}

export function editReply(file: CommentFile, doc: string, id: string, replyId: string, body: string): Comment {
  const c = find(file, doc, id);
  const r = findReply(c, replyId);
  r.body = body;
  r.editedAt = now();
  return c;
}

export function deleteReply(file: CommentFile, doc: string, id: string, replyId: string): Comment {
  const c = find(file, doc, id);
  findReply(c, replyId);
  c.replies = c.replies.filter((r) => r.id !== replyId);
  return c;
}

export function setStatus(file: CommentFile, doc: string, id: string, status: CommentStatus, by: string): Comment {
  const c = find(file, doc, id);
  c.status = status;
  if (status === "resolved") {
    c.resolvedAt = now();
    c.resolvedBy = by;
  } else {
    if (c.resolvedAt) {
      c.reopenedAt = now();
      c.reopenedBy = by;
    }
    delete c.resolvedAt;
    delete c.resolvedBy;
  }
  return c;
}

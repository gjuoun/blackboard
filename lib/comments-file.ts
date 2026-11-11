import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { QuoteSelector } from "./anchor";

/**
 * The comment model and its reducers, shared by the JSON-era file format and the SQLite rows
 * that replaced it. `CommentFile` stays the wire shape — the API answers `docs`-keyed maps, so a
 * store switch does not change the thread structure a client sees. `readComments` keeps parsing
 * the on-disk format for the migration source readers.
 */
export type Reply = { id: string; body: string; author: string; createdAt: string; editedAt?: string };
type CommentStatus = "open" | "resolved";
export type Comment = {
  id: string;
  /** Exactly one anchor kind: a passage in the doc (`quote`), or none (`general`). */
  quote?: QuoteSelector;
  /** An independent comment: no passage. Listed at the bottom of the Comments pane. */
  general?: true;
  body: string;
  /** Stored comment image ids (`<sha256>.<ext>`), shown as thumbnails under the body. */
  images?: string[];
  author: string;
  createdAt: string;
  editedAt?: string;
  status: CommentStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  /** The paragraph block this quote landed on (id + rev at write time), and what that block
   *  looks like now. `modified` / `deleted` keep `before` — the text the comment was made
   *  against — so a rewrite never strands the thread on an invisible anchor. `modified` also
   *  carries `after`, the block's present text. Absent for general comments and for quotes
   *  nothing holds. */
  block?: { id: string; rev: number; state: "current" | "modified" | "deleted"; before?: string; after?: string };
  replies: Reply[];
};
/** One round's review: the agent has answered each open comment and closes the round. */
export type Review = { id: string; doc: string; round: number; body: string; author: string; createdAt: string; verdict: "commented" };
export type CommentFile = { version: 1; docs: Record<string, Comment[]>; reviews?: Review[] };

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

/** The comments in a comment file; empty when the file does not exist. A file that does not parse is an error, never silently replaced. */
export function readComments(p: string): CommentFile {
  if (!existsSync(p)) return { version: 1, docs: {} };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || typeof data.docs !== "object") throw new Error(`unsupported comment file: ${p}`);
  return data as CommentFile;
}

export const commentId = (): string => newId("c");
export const replyId = (): string => newId("r");
export const reviewId = (): string => newId("v");

import type { CommentFile } from "./comments-store";

export type ActivityKind = "comment" | "reply" | "edit" | "reopen" | "resolve";
export type Activity = {
  kind: ActivityKind;
  doc: string;
  commentId: string;
  replyId?: string;
  author: string;
  at: string;
  /** The new text for comment/reply/edit; the comment's note for reopen/resolve. */
  body: string;
  /** The commented passage, whitespace squashed. */
  quote: string;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * What other people did on a session after `since`: new comments and replies, edits, reopens and
 * resolves, oldest first. `me` filters out the caller's own writes. `next` is the newest event
 * time (or `since`), to pass as the next `since`.
 */
export function activitySince(file: CommentFile, since: string, me: string): { events: Activity[]; next: string } {
  const events: Activity[] = [];
  const add = (e: Activity) => {
    if (e.at > since && e.author !== me) events.push(e);
  };
  for (const [doc, list] of Object.entries(file.docs)) {
    for (const c of list) {
      const base = { doc, commentId: c.id, quote: squash(c.quote.exact) };
      add({ ...base, kind: "comment", author: c.author, at: c.createdAt, body: c.body });
      if (c.editedAt) add({ ...base, kind: "edit", author: c.author, at: c.editedAt, body: c.body });
      if (c.reopenedAt && c.status === "open") add({ ...base, kind: "reopen", author: c.reopenedBy ?? "", at: c.reopenedAt, body: c.body });
      if (c.resolvedAt && c.status === "resolved") add({ ...base, kind: "resolve", author: c.resolvedBy ?? "", at: c.resolvedAt, body: c.body });
      for (const r of c.replies) {
        add({ ...base, kind: "reply", replyId: r.id, author: r.author, at: r.createdAt, body: r.body });
        if (r.editedAt) add({ ...base, kind: "edit", replyId: r.id, author: r.author, at: r.editedAt, body: r.body });
      }
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  return { events, next: events.at(-1)?.at ?? since };
}

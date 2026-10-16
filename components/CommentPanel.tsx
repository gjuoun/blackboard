"use client";

import { useState, type ReactNode } from "react";
import type { Comment } from "@/lib/comments-store";

export type PanelComment = Comment & { orphaned: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function ReplyBox({ onReply }: { onReply: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const submit = async () => {
    if (!body.trim()) return;
    await onReply(body.trim());
    setBody("");
  };
  return (
    <div className="reply-box">
      <input
        data-testid="reply-input"
        placeholder="Reply…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      <button data-testid="reply-save" onClick={submit} disabled={!body.trim()}>
        Reply
      </button>
    </div>
  );
}

type Props = {
  comments: PanelComment[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onReply: (id: string, body: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
  author: string;
  onAuthor: (v: string) => void;
  composer: ReactNode;
  toolbar?: ReactNode;
  error: string | null;
};

/** Side panel: the composer, then every comment on the doc in reading order, orphans last. */
export function CommentPanel(p: Props) {
  const open = p.comments.filter((c) => c.status === "open").length;
  const resolved = p.comments.length - open;
  const visible = p.comments.filter((c) => p.showResolved || c.status === "open");
  return (
    <aside className="comment-panel" data-testid="comment-panel" aria-label="Comments">
      <div className="panel-head">
        <h2>
          Comments <span className="muted">{open} open</span>
        </h2>
        {p.toolbar}
      </div>
      <div className="panel-meta">
        <label>
          as{" "}
          <input data-testid="author-input" className="author-input" value={p.author} onChange={(e) => p.onAuthor(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" data-testid="show-resolved" checked={p.showResolved} onChange={(e) => p.onShowResolved(e.target.checked)} /> show
          resolved ({resolved})
        </label>
      </div>
      {p.error ? <p className="panel-error">{p.error}</p> : null}
      {p.composer}
      {visible.length === 0 && !p.composer ? <p className="muted panel-empty">Select text in the doc to comment.</p> : null}
      <ol className="comment-list">
        {visible.map((c) => (
          <li
            key={c.id}
            data-testid="comment-item"
            data-id={c.id}
            data-status={c.status}
            data-orphaned={String(c.orphaned)}
            className={`comment-item${c.id === p.activeId ? " is-active" : ""}`}
            onClick={() => p.onActivate(c.id)}
          >
            <blockquote className="comment-quote" title={c.quote.exact}>
              {squash(c.quote.exact)}
            </blockquote>
            {c.orphaned ? <p className="orphan-note">Passage no longer in the doc</p> : null}
            <p className="comment-body">{c.body}</p>
            <p className="comment-meta muted">
              {c.author} · <time suppressHydrationWarning>{when(c.createdAt)}</time>
              {c.status === "resolved" && c.resolvedBy ? ` · resolved by ${c.resolvedBy}` : ""}
            </p>
            {c.replies.length > 0 ? (
              <ul className="reply-list">
                {c.replies.map((r) => (
                  <li key={r.id}>
                    <p className="comment-body">{r.body}</p>
                    <p className="comment-meta muted">
                      {r.author} · <time suppressHydrationWarning>{when(r.createdAt)}</time>
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
              <ReplyBox onReply={(body) => p.onReply(c.id, body)} />
              <button data-testid="resolve-toggle" onClick={() => p.onResolve(c.id, c.status === "open")}>
                {c.status === "open" ? "Resolve" : "Reopen"}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

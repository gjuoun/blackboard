"use client";

import { useState, type ReactNode } from "react";
import type { Comment } from "@/lib/comments-store";
import { exportComments } from "@/lib/export";

export type PanelComment = Comment & { orphaned: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A comment or reply body that its author can edit in place. */
function Body({ text, editing, onSave, onCancel }: { text: string; editing: boolean; onSave: (v: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  if (!editing) return <p className="comment-body">{text}</p>;
  const save = async () => {
    if (value.trim() && value.trim() !== text) await onSave(value.trim());
    onCancel();
  };
  return (
    <div className="edit-box">
      <textarea
        data-testid="edit-input"
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="composer-actions">
        <button onClick={onCancel}>Cancel</button>
        <button data-testid="edit-save" className="primary" onClick={save} disabled={!value.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}

/** "jun · Oct 16, 1:10 PM · edited" plus Edit/Delete for the author's own text. */
function Meta(p: { author: string; createdAt: string; editedAt?: string; extra?: string; own: boolean; onEdit: () => void; onDelete: () => void; kind: "comment" | "reply" }) {
  return (
    <div className="comment-meta muted">
      <span>
        {p.author} · <time suppressHydrationWarning>{when(p.createdAt)}</time>
        {p.editedAt ? " · edited" : ""}
        {p.extra ?? ""}
      </span>
      {p.own ? (
        <span className="meta-actions">
          <button className="link" data-testid={`${p.kind}-edit`} onClick={p.onEdit}>
            Edit
          </button>
          <button className="link danger" data-testid={`${p.kind}-delete`} onClick={p.onDelete}>
            Delete
          </button>
        </span>
      ) : null}
    </div>
  );
}

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

/** Copies the open comments as markdown, to paste to an agent by hand. */
function CopyButton({ board, doc, comments }: { board: string; doc: string; comments: PanelComment[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportComments(board, doc, comments));
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button data-testid="copy-comments" onClick={copy} title="Copy open comments as markdown">
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed" : "Copy open"}
    </button>
  );
}

type Props = {
  board: string;
  doc: string;
  comments: PanelComment[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onReply: (id: string, body: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEditReply: (id: string, replyId: string, body: string) => Promise<void>;
  onDeleteReply: (id: string, replyId: string) => Promise<void>;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
  author: string;
  onAuthor: (v: string) => void;
  composer: ReactNode;
  error: string | null;
};

/** Side panel: the composer, then every comment on the doc in reading order, orphans last. */
export function CommentPanel(p: Props) {
  // Id of the comment or reply being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const me = p.author.trim() || "jun";
  const open = p.comments.filter((c) => c.status === "open").length;
  const resolved = p.comments.length - open;
  const visible = p.comments.filter((c) => p.showResolved || c.status === "open");
  return (
    <aside className="comment-panel" data-testid="comment-panel" aria-label="Comments">
      <div className="panel-head">
        <h2>
          Comments <span className="muted">{open} open</span>
        </h2>
        <CopyButton board={p.board} doc={p.doc} comments={p.comments} />
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
            <Body key={c.body} text={c.body} editing={editing === c.id} onSave={(v) => p.onEdit(c.id, v)} onCancel={() => setEditing(null)} />
            <Meta
              kind="comment"
              author={c.author}
              createdAt={c.createdAt}
              editedAt={c.editedAt}
              extra={c.status === "resolved" && c.resolvedBy ? ` · resolved by ${c.resolvedBy}` : ""}
              own={c.author === me}
              onEdit={() => setEditing(c.id)}
              onDelete={() => {
                if (confirm("Delete this comment and its replies?")) void p.onDelete(c.id);
              }}
            />
            {c.replies.length > 0 ? (
              <ul className="reply-list">
                {c.replies.map((r) => (
                  <li key={r.id} data-testid="reply-item">
                    <Body key={r.body} text={r.body} editing={editing === r.id} onSave={(v) => p.onEditReply(c.id, r.id, v)} onCancel={() => setEditing(null)} />
                    <Meta
                      kind="reply"
                      author={r.author}
                      createdAt={r.createdAt}
                      editedAt={r.editedAt}
                      own={r.author === me}
                      onEdit={() => setEditing(r.id)}
                      onDelete={() => {
                        if (confirm("Delete this reply?")) void p.onDeleteReply(c.id, r.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
              <ReplyBox onReply={(body) => p.onReply(c.id, body)} />
              <div className="comment-buttons">
                <button data-testid="resolve-toggle" onClick={() => p.onResolve(c.id, c.status === "open")}>
                  {c.status === "open" ? "Resolve" : "Reopen"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

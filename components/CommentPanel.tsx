"use client";

import { ArrowUp, Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Comment } from "@/lib/comments-store";
import { exportComments } from "@/lib/export";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const TEXTAREA = "border-input bg-background focus-visible:ring-ring/40 w-full resize-y rounded-lg border p-2 text-[13.5px] outline-none focus-visible:ring-[3px]";

export type PanelComment = Comment & { orphaned: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A comment or reply body that its author can edit in place. */
function Body({ text, editing, onSave, onCancel }: { text: string; editing: boolean; onSave: (v: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  if (!editing) return <p className="m-0 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap">{text}</p>;
  const save = async () => {
    if (value.trim() && value.trim() !== text) await onSave(value.trim());
    onCancel();
  };
  return (
    <div>
      <textarea
        className={TEXTAREA}
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
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button size="xs" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button size="xs" data-testid="edit-save" onClick={save} disabled={!value.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** "jun · Oct 16, 1:10 PM · edited · resolved by x". */
function Info(p: { author: string; createdAt: string; editedAt?: string; extra?: string }) {
  return (
    <span className="min-w-0 truncate">
      <span className="text-foreground font-medium">{p.author}</span> · <time suppressHydrationWarning>{when(p.createdAt)}</time>
      {p.editedAt ? " · edited" : ""}
      {p.extra ?? ""}
    </span>
  );
}

/** Edit / Delete for the author's own text; shown on hover (always on touch screens). */
function Actions(p: { kind: "comment" | "reply"; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="flex shrink-0 gap-0.5 text-xs [@media(hover:hover)]:invisible group-focus-within:visible group-hover:visible">
      <button className="text-primary px-1" data-testid={`${p.kind}-edit`} onClick={p.onEdit}>
        Edit
      </button>
      <button className="text-destructive px-1" data-testid={`${p.kind}-delete`} onClick={p.onDelete}>
        Delete
      </button>
    </span>
  );
}

/** A reply's one-line meta: who, when, and Edit/Delete when it is the reader's own. */
function Meta(p: { author: string; createdAt: string; editedAt?: string; own: boolean; onEdit: () => void; onDelete: () => void; kind: "comment" | "reply" }) {
  return (
    <div className="text-muted-foreground mb-0.5 flex items-baseline justify-between gap-1.5 text-xs">
      <Info author={p.author} createdAt={p.createdAt} editedAt={p.editedAt} />
      {p.own ? <Actions kind={p.kind} onEdit={p.onEdit} onDelete={p.onDelete} /> : null}
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
    <div className="relative min-w-0">
      <input
        className="border-input bg-background focus-visible:ring-ring/40 h-8 w-full min-w-0 rounded-full border pr-9 pl-3 text-[13px] outline-none focus-visible:ring-[3px]"
        data-testid="reply-input"
        placeholder="Reply…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      <button
        data-testid="reply-save"
        aria-label="Send reply"
        title="Send reply"
        onClick={submit}
        disabled={!body.trim()}
        className="bg-primary text-primary-foreground absolute top-1 right-1 grid size-6 place-items-center rounded-full transition-opacity disabled:opacity-0"
      >
        <ArrowUp className="size-3.5" />
      </button>
    </div>
  );
}

/** Copies the open comments as markdown, to paste to an agent by hand. */
function CopyButton({ title, path, comments }: { title: string; path: string; comments: PanelComment[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportComments(title, path, comments));
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      data-testid="copy-comments"
      onClick={copy}
      aria-label="Copy open comments as markdown"
      title={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy open comments as markdown"}
      className={state === "copied" ? "text-success" : state === "failed" ? "text-destructive" : "text-muted-foreground"}
    >
      {state === "copied" ? <Check /> : <Copy />}
    </Button>
  );
}

/** Who the reader comments as: a small chip that turns into an input on click. */
function AuthorChip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const name = value.trim() || "jun";
  if (editing)
    return (
      <input
        data-testid="author-input"
        autoFocus
        aria-label="Comment as"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setEditing(false)}
        className="border-input bg-background focus-visible:ring-ring/40 h-7 w-24 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-[3px]"
      />
    );
  return (
    <button type="button" onClick={() => setEditing(true)} title="Commenting as — click to change" className="text-muted-foreground hover:bg-accent flex h-7 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-xs">
      <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-full text-[10px] font-semibold uppercase">{name[0]}</span>
      <span className="max-w-20 truncate">{name}</span>
    </button>
  );
}

type Props = {
  title: string;
  path: string;
  comments: PanelComment[];
  activeId: string | null;
  flashId: string | null;
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
    <div data-testid="comment-panel" aria-label="Comments" role="region" className="text-sm">
      <div className="mb-3 flex items-center gap-1">
        <h2 className="m-0 mr-auto flex items-center gap-1.5 text-[15px] font-semibold">
          Comments
          <span className="bg-primary-soft text-primary rounded-full px-1.5 text-xs leading-[18px] font-semibold" title={`${open} open`}>
            {open}
          </span>
        </h2>
        <AuthorChip value={p.author} onChange={p.onAuthor} />
        <Button
          size="icon-sm"
          variant="ghost"
          data-testid="show-resolved"
          aria-pressed={p.showResolved}
          aria-label="Show resolved comments"
          title={`${p.showResolved ? "Hide" : "Show"} resolved (${resolved})`}
          onClick={() => p.onShowResolved(!p.showResolved)}
          className={p.showResolved ? "bg-accent text-foreground" : "text-muted-foreground"}
        >
          {p.showResolved ? <Eye /> : <EyeOff />}
        </Button>
        <CopyButton title={p.title} path={p.path} comments={p.comments} />
      </div>
      {p.error ? <p className="text-destructive text-[13px]">{p.error}</p> : null}
      {p.composer}
      {visible.length === 0 && !p.composer ? <p className="text-muted-foreground text-[13px]">Select text in the doc to comment.</p> : null}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {visible.map((c) => (
          <li
            key={c.id}
            data-testid="comment-item"
            data-id={c.id}
            data-status={c.status}
            data-orphaned={String(c.orphaned)}
            tabIndex={-1}
            className={cn("group bg-card border-border cursor-pointer rounded-xl border p-3 outline-none", c.id === p.activeId && "border-primary ring-primary ring-1", c.id === p.flashId && "animate-[bb-flash_0.9s_ease-out]", c.status === "resolved" && "opacity-65", c.orphaned && "border-dashed")}
            onClick={() => p.onActivate(c.id)}
          >
            <div className="text-muted-foreground mb-2 flex items-center justify-between gap-2 text-xs">
              <Info author={c.author} createdAt={c.createdAt} editedAt={c.editedAt} extra={c.status === "resolved" && c.resolvedBy ? ` · resolved by ${c.resolvedBy}` : ""} />
              <button
                type="button"
                data-testid="resolve-toggle"
                aria-pressed={c.status === "resolved"}
                aria-label={c.status === "open" ? "Resolve" : "Reopen"}
                title={c.status === "open" ? "Resolve" : "Resolved — click to reopen"}
                onClick={(e) => {
                  e.stopPropagation();
                  void p.onResolve(c.id, c.status === "open");
                }}
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                  c.status === "resolved" ? "bg-success border-success text-white" : "border-border text-muted-foreground hover:border-success hover:text-success",
                )}
              >
                <Check className="size-3.5" strokeWidth={2.5} />
              </button>
            </div>
            <blockquote className="bg-background text-muted-foreground m-0 mb-2 line-clamp-3 rounded-lg px-2.5 py-1 text-[12.5px]" title={c.quote.exact}>
              {squash(c.quote.exact)}
            </blockquote>
            {c.orphaned ? <p className="text-warn m-0 mb-1.5 text-xs">Passage no longer in the doc</p> : null}
            <Body key={c.body} text={c.body} editing={editing === c.id} onSave={(v) => p.onEdit(c.id, v)} onCancel={() => setEditing(null)} />
            {c.author === me ? (
              <div className="mt-1 flex justify-end" onClick={(e) => e.stopPropagation()}>
                <Actions
                  kind="comment"
                  onEdit={() => setEditing(c.id)}
                  onDelete={() => {
                    if (confirm("Delete this comment and its replies?")) void p.onDelete(c.id);
                  }}
                />
              </div>
            ) : null}
            {c.replies.length > 0 ? (
              <ul className="border-border mt-2 flex list-none flex-col gap-1.5 border-l-2 p-0 pl-2.5">
                {c.replies.map((r) => (
                  <li key={r.id} data-testid="reply-item">
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
                    <Body key={r.body} text={r.body} editing={editing === r.id} onSave={(v) => p.onEditReply(c.id, r.id, v)} onCancel={() => setEditing(null)} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
              <ReplyBox onReply={(body) => p.onReply(c.id, body)} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

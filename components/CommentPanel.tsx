"use client";

import { ArrowUp, Check, Eye, EyeOff } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { anchorLabel, rowKey } from "@/lib/code-anchor";
import type { RenderedComment } from "@/lib/comment-markdown";
import { fileHref } from "@/lib/hrefs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Review } from "@/lib/comments-store";
import { ReviewCard } from "./ReviewCard";

const TEXTAREA = "border-input bg-background focus-visible:ring-ring/40 w-full resize-y rounded-lg border p-2 text-[13.5px] outline-none focus-visible:ring-[3px]";

/** `orphaned` covers either anchor kind; `movedTo` is the line a drifted code anchor reads on today. */
export type PanelComment = RenderedComment & { orphaned: boolean; movedTo?: number | null };

/** One entry of a comment's thread: a dot on the timeline line, no card around it. */
const THREAD_ENTRY = "thread-entry";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A comment or reply body that its author can edit in place. */
/** The body as the server rendered it (HTML, never parsed here); the raw text only while editing. */
function Body({ text, html, editing, onSave, onCancel }: { text: string; html: string; editing: boolean; onSave: (v: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  if (!editing) return <div className="comment-md text-[13.5px] leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: html }} />;
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

type Props = {
  title: string;
  path: string;
  comments: PanelComment[];
  /** Round reviews: listed after the anchored comments, before the independent (general) ones. */
  reviews?: Review[];
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
  /** One comment: its thread, its resolve toggle and its reply box. Kept as it was; only where it renders moved. */
  const renderItem = (c: PanelComment) => (
          <li
            data-testid="comment-item"
            data-kind={c.general ? "general" : c.code ? "code" : "quote"}
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
            {c.code ? (
              <p className="m-0 mb-2 flex flex-wrap items-center gap-1.5">
                <a
                  className="comment-chip"
                  data-testid="code-chip"
                  href={fileHref(c.code.path, { start: c.code.startLine, end: c.code.startLine })}
                  title={`${c.code.path}:${rowKey(c.code)}`}
                >
                  {anchorLabel(c.code)}
                </a>
                {c.orphaned ? (
                  <span className="cc-orphan" data-testid="code-chip-orphan">
                    {rowKey(c.code)}
                    {c.movedTo ? " ↦ 现 L" + c.movedTo : ""}
                  </span>
                ) : null}
              </p>
            ) : c.quote ? (
              <blockquote className="bg-background text-muted-foreground m-0 mb-2 line-clamp-3 rounded-lg px-2.5 py-1 text-[12.5px]" title={c.quote.exact}>
                {squash(c.quote.exact)}
              </blockquote>
            ) : null}
            {c.orphaned && !c.code ? <p className="text-warn m-0 mb-1.5 text-xs">Passage no longer in the doc</p> : null}
            <ol data-testid="thread" className="thread mt-2 flex list-none flex-col gap-3 p-0">
              <li data-testid="thread-entry" data-kind="comment" className={THREAD_ENTRY}>
                <Body key={c.body} text={c.body} html={c.html} editing={editing === c.id} onSave={(v) => p.onEdit(c.id, v)} onCancel={() => setEditing(null)} />
                {c.images?.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="comment-images">
                    {c.images.map((id) => (
                      // eslint-disable-next-line @next/next/no-img-element -- stored images are served by our own route; next/image would add an optimizer hop
                      <img key={id} src={`/api/comment-images/${id}`} alt="attached image" loading="lazy" className="max-w-[96px] max-h-[96px] rounded-md border border-border object-cover" />
                    ))}
                  </div>
                ) : null}
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
              </li>
              {c.replies.map((r) => (
                <li key={r.id} data-testid="reply-item" className={THREAD_ENTRY}>
                  {/* Every reply keeps its own name-and-clock line: that is what makes a thread readable. */}
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
                  <Body key={r.body} text={r.body} html={r.html} editing={editing === r.id} onSave={(v) => p.onEditReply(c.id, r.id, v)} onCancel={() => setEditing(null)} />
                </li>
              ))}
            </ol>
            <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
              <ReplyBox onReply={(body) => p.onReply(c.id, body)} />
            </div>
          </li>
  );

  return (
    <div data-testid="comment-panel" aria-label="Comments" role="region" className="text-sm">
      {/* No title row: the tab strip carries the count. The composer is the one write point. */}
      {p.error ? <p className="text-destructive text-[13px]">{p.error}</p> : null}
      {p.composer}
      <div className="mb-2 flex justify-end">
        <Button size="xs" variant="ghost" data-testid="show-resolved" aria-pressed={p.showResolved} onClick={() => p.onShowResolved(!p.showResolved)} className={p.showResolved ? "text-foreground" : "text-muted-foreground"}>
          {p.showResolved ? <Eye /> : <EyeOff />} {p.showResolved ? "Hide" : "Show"} resolved ({resolved})
        </Button>
      </div>
      {visible.length === 0 && !p.composer ? <p className="text-muted-foreground text-[13px]">Select text in the doc to comment.</p> : null}
      {/* Three groups in order: anchored comments, then round reviews, then independent (general) comments.
          The reviews are their own group, so they render with or without comments. */}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {visible.filter((c) => !c.general).map((c) => (
          <Fragment key={c.id}>{renderItem(c)}</Fragment>
        ))}
        {(p.reviews ?? []).map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
        {visible.some((c) => c.general) ? (
          <li aria-hidden className="text-muted-foreground flex items-center gap-2 text-[11px] uppercase tracking-wide" data-testid="general-divider">
            <span className="bg-border h-px flex-1" />general<span className="bg-border h-px flex-1" />
          </li>
        ) : null}
        {visible.filter((c) => c.general).map((c) => (
          <Fragment key={c.id}>{renderItem(c)}</Fragment>
        ))}
      </ol>
    </div>
  );
}

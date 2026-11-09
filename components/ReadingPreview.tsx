"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PreviewData, WorkspaceDoc } from "@/lib/reading-model";
import { PreviewReplyBar } from "./PreviewReplyBar";

/** A keyboard cap, the same shape as the sketch's `kbd`. */
function Kbd({ children }: { children: string }) {
  return <kbd className="border-border bg-background text-foreground rounded-[5px] border border-b-2 px-[5px] font-mono text-[10.5px] leading-4">{children}</kbd>;
}

const KEYS = (
  <>
    <Kbd>↑</Kbd>
    <Kbd>↓</Kbd> switch · <Kbd>Enter</Kbd> open · <Kbd>m</Kbd> mark read · <Kbd>Esc</Kbd> close
  </>
);

/** The body preview: the rendered document, the general-comment thread, and a reply box kept at the bottom. */
const PROSE = cn(
  "pt-3.5 text-[13px] leading-[1.8] text-foreground/90",
  "[&_p]:mb-[11px] [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-[15px] [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-semibold",
  "[&_ul]:mb-[11px] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-[11px] [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1",
  "[&_code]:bg-code [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11.5px] [&_pre]:border-border [&_pre]:bg-code [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_a]:text-primary [&_a]:underline",
  "[&_table]:mb-3 [&_table]:w-full [&_table]:text-[12px] [&_th]:border-border [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border-border [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_img]:max-w-full [&_img]:rounded-lg",
);

export type ReadingPreviewProps = {
  doc: WorkspaceDoc | null;
  preview: PreviewData | null;
  loading: boolean;
  error: string | null;
  /** Reopen at the position the document was left (the stored progress), when true. */
  resume: boolean;
  onClose: () => void;
  onMark: (id: string, action: "read" | "unread") => void;
  onProgress: (progress: number) => void;
  onReply: (text: string) => Promise<boolean>;
};

export function ReadingPreview({ doc, preview, loading, error, resume, onClose, onMark, onProgress, onReply }: ReadingPreviewProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const resumed = useRef(false);

  // Resume: once the document's HTML is in the pane, jump to the stored position exactly once.
  useEffect(() => {
    if (resumed.current || !resume || !preview) return;
    resumed.current = true;
    const el = bodyRef.current;
    if (el && doc) {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = max * doc.progress;
    }
  }, [resume, preview, doc]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await onReply(body);
    setSending(false);
    if (ok) setText("");
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(`${location.origin}/s/${doc?.id}`);
  };

  if (!doc) {
    return (
      <aside aria-label="Preview" data-testid="rw-preview" className="border-border bg-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l">
        <div data-testid="rw-empty" className="text-muted-foreground flex flex-1 flex-col justify-center gap-1.5 px-[26px] py-7">
          <div className="border-border bg-background mb-1 grid size-[34px] place-items-center rounded-[9px] border text-[15px]">◫</div>
          <p className="text-foreground m-0 text-sm font-semibold">Select a document</p>
          <span className="max-w-[240px] text-[12.5px] leading-[1.65]">Click any row to open it here: the body, the replies so far, and a reply box pinned at the bottom.</span>
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-[11px]">{KEYS}</div>
        </div>
      </aside>
    );
  }

  const unread = doc.status === "unread";
  return (
    <aside aria-label="Preview" data-testid="rw-preview" className="border-border bg-card relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l">
      {/* Phone: the mail-detail bar — ‹ back, the title centred, the ⋯ menu. No status badge, no
          progress: the state dot lives in the list row only. */}
      <div className="border-border flex h-[52px] flex-none items-center gap-2 border-b px-2.5 md:hidden">
        <button type="button" onClick={onClose} aria-label="Back to list" title="Back to list" data-testid="rw-back" className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[34px] place-items-center rounded-[9px] pb-1 text-[22px]">
          ‹
        </button>
        <span data-testid="rw-mobile-title" className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold">
          {doc.title}
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More"
          aria-expanded={menuOpen}
          title="More"
          data-testid="rw-menu-open"
          className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[34px] place-items-center rounded-[9px] text-base"
        >
          ⋯
        </button>
      </div>
      {menuOpen ? (
        <div data-testid="rw-menu" className="border-border bg-card absolute top-[46px] right-2.5 z-20 w-[168px] rounded-[10px] border p-[5px] shadow-[0_20px_44px_-30px_rgba(0,0,0,0.65)] md:hidden">
          <button
            type="button"
            data-testid="rw-menu-mark"
            onClick={() => {
              onMark(doc.id, unread ? "read" : "unread");
              setMenuOpen(false);
            }}
            className="hover:bg-accent flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[12.5px]"
          >
            <span>{unread ? "Mark read" : "Mark unread"}</span>
            <span className="text-muted-foreground ml-auto text-[11px]">●</span>
          </button>
          <Link
            href={`/s/${doc.id}`}
            data-testid="rw-menu-open-doc"
            onClick={() => setMenuOpen(false)}
            className="hover:bg-accent flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[12.5px]"
          >
            <span>Open document</span>
            <span className="text-muted-foreground ml-auto text-[11px]">↗</span>
          </Link>
          <button
            type="button"
            data-testid="rw-menu-copy"
            onClick={() => {
              copyLink();
              setMenuOpen(false);
            }}
            className="hover:bg-accent flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[12.5px]"
          >
            <span>Copy link</span>
            <span className="text-muted-foreground ml-auto text-[11px]">⧉</span>
          </button>
        </div>
      ) : null}

      {/* 10px of bottom padding inside the scroll, so the last reply is never under the reply bar. */}
      <div
        ref={bodyRef}
        data-testid="rw-preview-body"
        onScroll={(e) => {
          const el = e.currentTarget;
          const max = el.scrollHeight - el.clientHeight;
          onProgress(max > 4 ? el.scrollTop / max : 1);
        }}
        className="min-h-0 flex-1 overflow-auto px-[18px] pb-2.5"
        onClick={() => menuOpen && setMenuOpen(false)}
      >
        <h2 data-testid="rw-preview-title" className="mt-3.5 text-[18px] leading-[1.42] font-bold tracking-[-0.01em]">
          {doc.title}
        </h2>
        <div className="text-muted-foreground border-border mt-[9px] flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b pb-3 font-mono text-[10.5px]">
          <span className="break-all">{doc.location}</span>
          {doc.branch ? <span className="opacity-45">·</span> : null}
          {doc.branch ? <span>⎇ {doc.branch}</span> : null}
          <span className="opacity-45">·</span>
          <span>{preview ? `${preview.sections} sections` : "…"}</span>
          <span className="opacity-45">·</span>
          <span>{doc.updated}</span>
        </div>

        {loading ? <p className="text-muted-foreground pt-4 text-[12.5px]">Loading the document…</p> : null}
        {error ? <p className="text-primary pt-4 text-[12.5px]">{error}</p> : null}
        {preview && !loading && !error ? (
          <>
            <div data-testid="rw-preview-html" className={PROSE} dangerouslySetInnerHTML={{ __html: preview.html }} />
            {preview.replies.length > 0 ? (
              <>
                <div className="text-muted-foreground mt-[18px] mb-2.5 flex items-center gap-2 font-mono text-[10.5px] after:h-px after:flex-1 after:bg-[var(--border)]">
                  Replies · {preview.replies.length}
                </div>
                <div className="flex flex-col gap-2">
                  {preview.replies.map((reply) => (
                    <div key={reply.id} data-testid="rw-reply" className="border-border bg-background rounded-lg border px-2.5 py-2">
                      <div className="text-muted-foreground flex items-center gap-1.5 text-[10.5px]">
                        <b className="text-foreground text-[11.5px] font-semibold">{reply.author}</b>
                        <span>{reply.updated}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-[1.6] break-words whitespace-pre-wrap">{reply.body}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* The desktop actions stay inside the scroll; on a phone these live in the ⋯ menu. */}
        <div className="mt-4 hidden gap-2 md:flex">
          <button
            type="button"
            data-testid="rw-preview-toggle"
            onClick={() => onMark(doc.id, doc.status === "read" ? "unread" : "read")}
            className="bg-primary text-primary-foreground flex h-8 flex-1 items-center justify-center rounded-lg px-3 text-[12.5px] hover:brightness-105"
          >
            {doc.status === "read" ? "Mark unread" : "Mark read"}
          </button>
          <Link href={`/s/${doc.id}`} className="border-border bg-card hover:bg-accent flex h-8 items-center rounded-lg border px-3 text-[12.5px]">
            Open ↗
          </Link>
        </div>
        <div className="text-muted-foreground mt-3.5 hidden flex-wrap items-center gap-1.5 text-[11px] md:flex">{KEYS}</div>
      </div>

      {/* Phone: the pinned reply affordance — a pill that expands into the inline composer. */}
      <PreviewReplyBar onReply={onReply} />

      {/* Desktop: the reply box as it was. */}
      <div className="border-border bg-card hidden flex-none border-t px-4 pt-2.5 pb-3.5 md:block">
        <div className="text-muted-foreground mb-1.5 text-[10.5px]">Replies are added as comments on this document</div>
        <div className="flex items-center gap-2">
          <input
            data-testid="rw-reply-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Reply…"
            aria-label="Reply to this document"
            autoComplete="off"
            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary-soft h-[34px] min-w-0 flex-1 rounded-lg border px-3 text-[12.5px] outline-none focus:ring-[3px]"
          />
          <button
            type="button"
            data-testid="rw-reply-send"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            aria-label="Send reply"
            title="Send (Enter)"
            className="bg-primary text-primary-foreground grid size-8 flex-none place-items-center rounded-full text-[15px] leading-none hover:brightness-105 disabled:opacity-50"
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  );
}

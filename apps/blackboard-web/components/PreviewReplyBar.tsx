"use client";

import { useState } from "react";

const REPLY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0 opacity-75" aria-hidden>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h9a6 6 0 0 1 6 6v1" />
  </svg>
);

const SEND_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);

/**
 * The phone's pinned reply affordance: a pill that reads like an input and a round send key. A tap
 * on either expands the bar in place into a textarea with Cancel / Send; sending or cancelling
 * folds it back to the pill. Taps only — no gestures. Desktop renders the reply box inline in the
 * preview instead, so this bar hides at 768px and up.
 */
export function PreviewReplyBar({ onReply }: { onReply: (text: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await onReply(body);
    setSending(false);
    if (ok) {
      setText("");
      setOpen(false);
    }
  };

  return (
    <div data-testid="rw-replybar" className="border-border bg-card flex-none border-t px-2.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden">
      {open ? (
        <div className="p-0.5">
          <textarea
            data-testid="rw-composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Replies are added as comments on this document…"
            aria-label="Reply to this document"
            autoFocus
            className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary-soft block min-h-[54px] w-full resize-none rounded-lg border px-3 py-2 text-[13px] leading-[1.6] outline-none focus:ring-[3px]"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="flex-1" />
            <button type="button" data-testid="rw-composer-cancel" onClick={() => setOpen(false)} className="text-muted-foreground h-7 rounded-lg px-2.5 text-xs">
              Cancel
            </button>
            <button
              type="button"
              data-testid="rw-composer-send"
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="bg-primary text-primary-foreground h-7 rounded-lg px-3 text-xs hover:brightness-105 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="rw-reply-pill"
            onClick={() => setOpen(true)}
            className="border-border bg-background text-muted-foreground flex h-9 flex-1 items-center gap-2 rounded-full border px-3.5 text-left text-[12.5px]"
          >
            {REPLY_ICON}
            Reply…
          </button>
          <button
            type="button"
            data-testid="rw-reply-send-round"
            onClick={() => setOpen(true)}
            aria-label="Reply"
            title="Reply"
            className="bg-primary text-primary-foreground grid size-9 flex-none place-items-center rounded-full"
          >
            {SEND_ICON}
          </button>
        </div>
      )}
    </div>
  );
}

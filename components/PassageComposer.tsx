"use client";

import { Button } from "@/components/ui/button";
import type { QuoteSelector } from "@/lib/anchor";

/** The block composer for a selected passage: the quote, the note, and its two buttons. */
export function PassageComposer({
  composing,
  note,
  onNote,
  onCancel,
  onSave,
}: {
  composing: QuoteSelector | null;
  note: string;
  onNote: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!composing) return null;
  return (
    <div className="border-primary mb-3 rounded-xl border p-2.5">
      <blockquote className="bg-background text-muted-foreground m-0 mb-2 line-clamp-3 rounded-lg px-2.5 py-1 text-[12.5px]">{composing.exact.replace(/\s+/g, " ").trim()}</blockquote>
      <textarea
        className="border-input bg-background focus-visible:ring-ring/40 w-full resize-y rounded-lg border p-2 text-[13.5px] outline-none focus-visible:ring-[3px]"
        data-testid="comment-input"
        autoFocus
        rows={3}
        placeholder="Comment…"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button size="xs" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" data-testid="comment-save" onClick={onSave} disabled={!note.trim()}>
          Comment
        </Button>
      </div>
    </div>
  );
}

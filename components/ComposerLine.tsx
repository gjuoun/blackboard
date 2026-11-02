"use client";

import { ImagePlus, ArrowUp } from "lucide-react";
import { useRef, useState } from "react";

/**
 * The right rail's one write point: an image button, a text input and a round send. No toolbar, no hint,
 * no second button. `onSend` receives the text and any uploaded image ids; the caller decides the anchor.
 */
export function ComposerLine({ onSend, disabled }: { onSend: (text: string, images: string[]) => Promise<void>; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const canSend = !busy && !disabled && (text.trim().length > 0 || images.length > 0);

  const upload = async (f: File) => {
    const res = await fetch("/api/comment-images", { method: "POST", body: f });
    const data = (await res.json()) as { id?: string; error?: string };
    if (data.id) setImages((xs) => [...xs, data.id as string].slice(0, 4));
  };

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSend(text.trim(), images);
      setText("");
      setImages([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mb-3 flex items-center gap-1.5" data-testid="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <button type="button" aria-label="Attach image" title="Attach image" data-testid="composer-image" onClick={() => file.current?.click()} className="text-muted-foreground hover:text-foreground grid size-8 shrink-0 place-items-center rounded-full">
        <ImagePlus className="size-4" />
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Comment…"
        aria-label="Comment"
        data-testid="composer-input"
        className="border-input bg-background focus-visible:ring-ring/40 h-8 min-w-0 flex-1 rounded-full border px-3 text-[13.5px] outline-none focus-visible:ring-[3px]"
      />
      <button type="submit" aria-label="Send comment" title="Send comment" data-testid="composer-send" disabled={!canSend} className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-full disabled:opacity-40">
        <ArrowUp className="size-4" />
      </button>
      {images.length ? <span className="text-muted-foreground text-xs">{images.length} image</span> : null}
    </form>
  );
}

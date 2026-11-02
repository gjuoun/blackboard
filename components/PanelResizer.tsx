"use client";

import { useRef } from "react";
import { clampPanel, DEFAULT_PREFS, DOC_MIN, PANEL_LIMITS, type PanelKey } from "@/lib/prefs";
import { cn } from "@/lib/utils";

type Props = {
  which: PanelKey;
  /** Current width of the panel being resized. */
  width: number;
  /** Width of the other open panel, so the doc keeps its 480px floor. */
  other: number;
  /** Live width while the pointer is down; null when the drag ends. */
  onDraft: (width: number | null) => void;
  /** The width to persist when the drag ends (or a key/double-click moves it). */
  onCommit: (width: number) => void;
};

/**
 * A 6px grip on the inner edge of a side panel. Pointer capture keeps the drag alive outside the
 * handle; the width only hits localStorage on release, so a drag is one write rather than one per
 * pixel. Keyboard is the same code path: arrows step, Shift steps faster, Home resets.
 */
export function PanelResizer({ which, width, other, onDraft, onCommit }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const draft = useRef<number | null>(null);
  const limits = PANEL_LIMITS[which];

  /** Fit a requested width into the panel range and the viewport, never squeezing the doc. */
  const fit = (requested: number) => {
    const room = typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth - other - DOC_MIN;
    return Math.max(limits.min, Math.min(clampPanel(requested, which), room));
  };

  const delta = (clientX: number) => (start.current ? (which === "toc" ? clientX - start.current.x : start.current.x - clientX) : 0);

  const stop = () => {
    start.current = null;
    draft.current = null;
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={which === "toc" ? "Resize contents panel" : "Resize comments panel"}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      data-testid={"resize-" + which}
      data-resizer={which}
      title="Drag to resize · double-click to reset"
      className={cn(
        "group absolute inset-y-0 z-20 hidden w-1.5 cursor-col-resize touch-none outline-none md:block",
        which === "toc" ? "right-0" : "left-0",
        "hover:bg-primary/25 focus-visible:bg-primary/30",
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        document.documentElement.dataset.resizing = "true";
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        draft.current = fit(start.current.width + delta(e.clientX));
        onDraft(draft.current);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const next = draft.current ?? fit(start.current.width + delta(e.clientX));
        stop();
        delete document.documentElement.dataset.resizing;
        onDraft(null);
        // Always commit: during the drag `width` is already the draft, so comparing against it
        // would swallow the release. setChrome is a no-op when the value really is unchanged.
        onCommit(next);
      }}
      onPointerCancel={() => {
        stop();
        delete document.documentElement.dataset.resizing;
        onDraft(null);
      }}
      onDoubleClick={() => onCommit(DEFAULT_PREFS[which === "toc" ? "tocW" : "cmW"])}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "Home") {
          e.preventDefault();
          onCommit(DEFAULT_PREFS[which === "toc" ? "tocW" : "cmW"]);
          return;
        }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        // Left always moves the grip left: wider comments, narrower contents.
        const grow = which === "toc" ? e.key === "ArrowRight" : e.key === "ArrowLeft";
        onCommit(fit(width + (grow ? step : -step)));
      }}
    />
  );
}

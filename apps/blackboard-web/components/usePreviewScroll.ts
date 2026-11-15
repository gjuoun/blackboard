"use client";

import { useCallback, useEffect, useRef } from "react";
import { withProgress, type WorkspaceDoc } from "@/lib/reading-model";

/**
 * The preview's scroll-position bookkeeping: paint the status locally on every scroll, post the
 * position after a quiet moment, and give explicit marks a grace period so a queued scroll write
 * cannot undo them. The position itself is stored, never displayed — it is only read back to resume.
 */
export function usePreviewScroll({
  selected,
  docs,
  setDocs,
  write,
}: {
  selected: string | null;
  docs: WorkspaceDoc[];
  setDocs: React.Dispatch<React.SetStateAction<WorkspaceDoc[]>>;
  write: (body: Record<string, unknown>) => Promise<void>;
}) {
  const docsRef = useRef(docs);
  const pendingProgress = useRef<{ id: string; progress: number } | null>(null);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Scroll events queued before an explicit mark or a selection change must not undo it. */
  const progressHold = useRef(0);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);
  useEffect(
    () => () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    },
    [],
  );

  /** An explicit mark wins over a scroll still waiting to be written: cancel that pending write. */
  const cancelProgress = useCallback(() => {
    if (progressTimer.current) {
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    pendingProgress.current = null;
  }, []);

  /** Give an explicit mark or a selection change this much quiet before scroll writes resume. */
  const holdProgress = useCallback((ms: number) => {
    progressHold.current = Date.now() + ms;
  }, []);

  const onProgress = useCallback(
    (progress: number) => {
      if (!selected || Date.now() < progressHold.current) return;
      const prev = docsRef.current.find((d) => d.id === selected)?.status;
      const entry = withProgress(progress, new Date().toISOString(), 0, prev);
      setDocs((list) => list.map((doc) => (doc.id === selected ? { ...doc, status: entry.status, progress: entry.progress } : doc)));
      pendingProgress.current = { id: selected, progress };
      if (progressTimer.current === null) {
        progressTimer.current = setTimeout(() => {
          progressTimer.current = null;
          const next = pendingProgress.current;
          pendingProgress.current = null;
          if (next) void write({ session: next.id, action: "progress", progress: next.progress });
        }, 600);
      }
    },
    [selected, setDocs, write],
  );

  return { docsRef, cancelProgress, holdProgress, onProgress };
}

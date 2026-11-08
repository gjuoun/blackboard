"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countStatuses, filterDocs, withProgress, type PreviewData, type ReadingFilter, type ReadingResult, type WorkspaceData } from "@/lib/reading-model";
import { cn } from "@/lib/utils";
import { ReadingHeader } from "./ReadingHeader";
import { ReadingList } from "./ReadingList";
import { ReadingPreview } from "./ReadingPreview";
import { ReadingRail } from "./ReadingRail";
import { ReadingToolbar } from "./ReadingToolbar";

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);

/**
 * The reading workspace: a three-column inbox over the session registry. The list and the preview
 * are two views of one state — selecting a row is what opens the document, and every state change
 * is written through `/api/reading`, which is what makes it survive a restart.
 */
export function ReadingWorkspace({ initial }: { initial: WorkspaceData }) {
  const router = useRouter();
  const [docs, setDocs] = useState(initial.docs);
  const [filter, setFilter] = useState<ReadingFilter>("all");
  const [repo, setRepo] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const visible = useMemo(() => filterDocs(docs, filter, query, repo), [docs, filter, query, repo]);
  const counts = useMemo(() => countStatuses(docs), [docs]);
  const pending = useMemo(() => docs.reduce((n, doc) => n + doc.open, 0), [docs]);

  /** Apply the entries a write answered with; the server's copy is authoritative. */
  const patch = useCallback((entries: ReadingResult["docs"]) => {
    setDocs((prev) => prev.map((doc) => (entries[doc.id] ? { ...doc, status: entries[doc.id].status, progress: entries[doc.id].progress } : doc)));
  }, []);

  const write = useCallback(
    async (body: Record<string, unknown>) => {
      const data = (await post("/api/reading", body)) as ReadingResult | null;
      if (!data) setError("Could not save the reading state");
      else patch(data.docs);
    },
    [patch],
  );

  /** An explicit mark wins over a scroll still waiting to be written: cancel that pending write. */
  const cancelProgress = useCallback(() => {
    if (progressTimer.current) {
      clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
    pendingProgress.current = null;
  }, []);

  const mark = useCallback(
    (id: string, action: "read" | "unread") => {
      cancelProgress();
      progressHold.current = Date.now() + 800;
      setDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, status: action, progress: action === "read" ? 1 : 0 } : doc)));
      void write({ session: id, action });
    },
    [write, cancelProgress],
  );

  /** Selecting a row opens it; the sketch's rule is that opening an unread document reads it. */
  const open = useCallback(
    (id: string) => {
      if (id === selected) return;
      cancelProgress();
      progressHold.current = Date.now() + 300;
      setSelected(id);
      setPreview(null);
      setError(null);
      setLoading(true);
      const doc = docsRef.current.find((d) => d.id === id);
      if (doc?.status === "unread") mark(id, "read");
    },
    [mark, selected, cancelProgress],
  );

  const close = useCallback(() => {
    setSelected(null);
    setPreview(null);
    setError(null);
    setLoading(false);
  }, []);

  // The fetch is started when the selection changes; every state write happens in its callbacks.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetch(`/api/reading/doc?session=${encodeURIComponent(selected)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("preview"))))
      .then((data: PreviewData) => {
        if (!alive) return;
        setPreview(data);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError("Could not load this document");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  /** Scroll position: paint locally on every scroll, write after a quiet moment. */
  const flushProgress = useCallback(() => {
    const next = pendingProgress.current;
    pendingProgress.current = null;
    if (next) void write({ session: next.id, action: "progress", progress: next.progress });
  }, [write]);

  const onProgress = useCallback(
    (progress: number) => {
      if (!selected || Date.now() < progressHold.current) return;
      const entry = withProgress(progress, new Date().toISOString(), 0);
      setDocs((prev) => prev.map((doc) => (doc.id === selected ? { ...doc, status: entry.status, progress: entry.progress } : doc)));
      pendingProgress.current = { id: selected, progress };
      if (progressTimer.current === null) {
        progressTimer.current = setTimeout(() => {
          progressTimer.current = null;
          flushProgress();
        }, 600);
      }
    },
    [selected, flushProgress],
  );

  const reply = useCallback(
    async (text: string) => {
      if (!selected) return false;
      const data = (await post("/api/comments", { session: selected, general: true, body: text, author: "jun" })) as { comment: { id: string; body: string; author: string; createdAt: string } } | null;
      if (!data) return false;
      const { comment } = data;
      setPreview((prev) =>
        prev && prev.id === selected
          ? { ...prev, replies: [...prev.replies, { id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt, updated: "just now" }] }
          : prev,
      );
      return true;
    },
    [selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!visible.length) return;
        const i = selected ? visible.findIndex((doc) => doc.id === selected) : -1;
        const next = e.key === "ArrowDown" ? visible[i < 0 ? 0 : Math.min(i + 1, visible.length - 1)] : visible[i < 0 ? visible.length - 1 : Math.max(i - 1, 0)];
        if (next) open(next.id);
        return;
      }
      if (e.key === "Enter" && selected) {
        e.preventDefault();
        router.push(`/s/${selected}`);
        return;
      }
      if (e.key === "m" && selected) {
        const doc = docsRef.current.find((d) => d.id === selected);
        if (doc) mark(doc.id, doc.status === "read" ? "unread" : "read");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, open, mark, router, close]);

  const selectedDoc = docs.find((doc) => doc.id === selected) ?? null;

  return (
    <div data-testid="rw-shell" className="flex h-[calc(100dvh-var(--bar-h))] flex-col overflow-hidden">
      <ReadingHeader
        query={query}
        onQuery={setQuery}
        pending={pending}
        onMarkAll={() => {
          setDocs((prev) => prev.map((doc) => (doc.status === "read" ? doc : { ...doc, status: "read", progress: 1 })));
          void write({ action: "read-all" });
        }}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_384px] lg:grid-cols-[236px_minmax(0,1fr)_384px]">
        <ReadingRail filter={filter} onFilter={setFilter} counts={counts} />

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <ReadingToolbar filter={filter} onFilter={setFilter} repos={initial.repos} repo={repo} onRepo={setRepo} counts={counts} />
          <div className="min-h-0 flex-1 overflow-auto">
            <ReadingList docs={visible} selected={selected} onSelect={open} onMark={mark} />
          </div>
        </section>

        <div className={cn("min-h-0 flex-col md:flex", selected ? "max-md:fixed max-md:inset-0 max-md:z-20 max-md:flex" : "max-md:hidden")}>
          <ReadingPreview
            key={selected ?? "empty"}
            doc={selectedDoc}
            preview={preview}
            loading={loading}
            error={error}
            onClose={close}
            onMark={mark}
            onProgress={onProgress}
            onReply={reply}
          />
        </div>
      </div>
    </div>
  );
}

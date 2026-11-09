"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clampInbox, LIST_MIN, type PanelKey } from "@/lib/prefs";
import { countStatuses, filterDocs, type PreviewData, type ReadingFilter, type ReadingResult, type WorkspaceData } from "@/lib/reading-model";
import { cn } from "@/lib/utils";
import { setChrome, useChrome, useIsDesktop } from "./chrome";
import { PanelResizer } from "./PanelResizer";
import { ReadingHeader } from "./ReadingHeader";
import { ReadingList } from "./ReadingList";
import { ReadingPreview } from "./ReadingPreview";
import { ReadingRail } from "./ReadingRail";
import { usePreviewScroll } from "./usePreviewScroll";
import { setWorkspaceBar } from "./workspace-bar";
import { WorkspaceNew } from "./WorkspaceNew";
import { isWorkspaceView, VIEW_FILTERS, WorkspaceTabBar, type WorkspaceView } from "./WorkspaceTabBar";

/** A media query as a hook, same subscribe pattern as the chrome store's desktop flag. */
const useMediaQuery = (query: string) =>
  useSyncExternalStore(
    (l) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", l);
      return () => mq.removeEventListener("change", l);
    },
    () => matchMedia(query).matches,
    () => false,
  );

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);

/** The view the URL asked for (`?f=…`), read once after mount — the server render cannot see it. */
const viewFromLocation = (): WorkspaceView | null => {
  const f = new URLSearchParams(location.search).get("f");
  return isWorkspaceView(f) ? f : null;
};

/**
 * The reading workspace: a three-column inbox on desktop, the mail-app shell on a phone — the list
 * with a bottom tab bar, a full-screen preview over it, and the New and Settings screens behind
 * the fourth and fifth tabs. The list and the preview are two views of one state; selecting a row
 * is what opens the document, and every state change is written through `/api/reading`.
 */
export function ReadingWorkspace({ initial }: { initial: WorkspaceData }) {
  const router = useRouter();
  const chrome = useChrome();
  const [docs, setDocs] = useState(initial.docs);
  const [view, setViewState] = useState<WorkspaceView>("all");
  const [repo, setRepo] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter: ReadingFilter = VIEW_FILTERS[view] ?? "all";

  // A deep link (or a tab tap) lands as `?f=…`; adopt it once, after mount.
  useEffect(() => {
    const v = viewFromLocation();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount
    if (v) setViewState(v);
  }, []);

  // The stored default repo applies while the repo filter is untouched ("" = all repos); a manual
  // pick of another repo wins until the preference itself changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    if (repo === "" && initial.repos.includes(chrome.docRepo)) setRepo(chrome.docRepo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `repo` is read, not driven
  }, [chrome.docRepo, initial.repos]);

  const visible = useMemo(() => filterDocs(docs, filter, query, repo), [docs, filter, query, repo]);
  const counts = useMemo(() => countStatuses(docs), [docs]);
  const pending = useMemo(() => docs.reduce((n, doc) => n + doc.open, 0), [docs]);

  /** Tab taps on the phone: filter views stay on this page, Settings navigates. */
  const setView = useCallback(
    (v: WorkspaceView) => {
      if (v === "settings") {
        router.push("/inbox/settings");
        return;
      }
      // A tab switch always lands on the list: an open preview closes with it.
      setSelected(null);
      setPreview(null);
      setLoading(false);
      setViewState(v);
      const f = VIEW_FILTERS[v];
      router.replace(f ? `/inbox?f=${f}` : "/inbox?f=new", { scroll: false });
    },
    [router],
  );

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

  const { docsRef, cancelProgress, holdProgress, onProgress } = usePreviewScroll({ selected, docs, setDocs, write });

  const mark = useCallback(
    (id: string, action: "read" | "unread") => {
      cancelProgress();
      holdProgress(800);
      // The optimistic copy mirrors the server rule: marking read keeps the position, marking
      // unread clears it — progress is position, never "finished".
      setDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, status: action, progress: action === "unread" ? 0 : doc.progress } : doc)));
      void write({ session: id, action });
    },
    [write, cancelProgress, holdProgress],
  );

  // The open handler and the key listener run outside render, so they read the latest values
  // through refs instead of re-binding on every state change.
  const markRef = useRef(mark);
  const readOnOpen = useRef(chrome.markReadOnOpen);
  useEffect(() => {
    markRef.current = mark;
    readOnOpen.current = chrome.markReadOnOpen;
  }, [mark, chrome.markReadOnOpen]);

  /** Selecting a row opens it; whether opening also marks it read is a reading preference. */
  const open = useCallback(
    (id: string) => {
      if (id === selected) return;
      cancelProgress();
      holdProgress(300);
      setSelected(id);
      setPreview(null);
      setError(null);
      setLoading(true);
      const doc = docsRef.current.find((d) => d.id === id);
      if (doc?.status === "unread" && readOnOpen.current) markRef.current(id, "read");
    },
    [selected, cancelProgress, holdProgress, docsRef],
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
        if (doc) markRef.current(doc.id, doc.status === "read" ? "unread" : "read");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, open, router, close, docsRef]);

  // The desktop top bar folds the inbox controls into itself; publish them while this page is
  // mounted and clear the slot on the way out so no other page inherits them.
  useEffect(() => {
    setWorkspaceBar({ query, onQuery: setQuery, repo, repos: initial.repos, onRepo: setRepo, filter, onFilter: (f) => setView(f), counts, pending });
    return () => setWorkspaceBar(null);
  }, [query, repo, initial.repos, filter, setView, counts, pending]);

  // The width being dragged right now: local until the pointer is released, so the column can
  // follow the grip without a localStorage write per pixel — the same model the doc page uses.
  const [resizing, setResizing] = useState<{ which: PanelKey; width: number } | null>(null);
  const desktop = useIsDesktop();
  // The rail is only in the grid from lg; below it the preview resizes against the window alone.
  const railOpen = useMediaQuery("(min-width: 1024px)");

  // A narrower window must not leave the list squeezed to nothing: re-clamp both side panels.
  // Only a viewport where the preview sits beside the list counts; below md nothing is resizable.
  useEffect(() => {
    const onResize = () => {
      if (!matchMedia("(min-width: 768px)").matches) return;
      const next = clampInbox({ railW: chrome.railW, previewW: chrome.previewW }, innerWidth);
      if (next.railW !== chrome.railW || next.previewW !== chrome.previewW) setChrome(next);
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [chrome.railW, chrome.previewW]);

  const selectedDoc = docs.find((doc) => doc.id === selected) ?? null;
  const listVisible = view !== "new";

  return (
    <div data-testid="rw-shell" className="flex h-[calc(100dvh-var(--bar-h))] flex-col overflow-hidden max-md:h-dvh">
      <ReadingHeader query={query} onQuery={setQuery} counts={counts} view={view} />

      {/* Column widths ride CSS variables (--rail-w / --preview-w) that the boot script paints
          before the first frame, so a stored width shows without a layout jump; the media queries
          in .inbox-grid match the Tailwind breakpoints the columns use. A live drag overrides the
          variable inline so the grip stays under the pointer. */}
      <div
        className="inbox-grid grid min-h-0 flex-1 [html[data-resizing]_&]:transition-none"
        style={{
          ...(resizing?.which === "rail" ? { "--rail-w": resizing.width + "px" } : null),
          ...(resizing?.which === "preview" ? { "--preview-w": resizing.width + "px" } : null),
        } as React.CSSProperties}
      >
        <div className="relative hidden lg:block">
          <ReadingRail filter={filter} onFilter={(f) => setView(f)} counts={counts} />
          {desktop ? (
            <PanelResizer
              which="rail"
              floor={LIST_MIN}
              width={resizing?.which === "rail" ? resizing.width : chrome.railW}
              other={chrome.previewW}
              breakpoint="lg"
              onDraft={(w) => setResizing(w === null ? null : { which: "rail", width: w })}
              onCommit={(w) => setChrome({ railW: w })}
            />
          ) : null}
        </div>

        <section className={cn("min-h-0 min-w-0 flex-col overflow-hidden", listVisible ? "flex" : "hidden md:flex")}>
          <div className="min-h-0 flex-1 overflow-auto">
            <ReadingList docs={visible} selected={selected} onSelect={open} onMark={mark} />
          </div>
        </section>

        {view === "new" ? <WorkspaceNew /> : null}

        <div className={cn("relative min-h-0 flex-col md:flex", selected ? "max-md:fixed max-md:inset-0 max-md:z-30 max-md:flex" : "max-md:hidden")}>
          {desktop ? (
            <PanelResizer
              which="preview"
              floor={LIST_MIN}
              width={resizing?.which === "preview" ? resizing.width : chrome.previewW}
              other={railOpen ? chrome.railW : 0}
              onDraft={(w) => setResizing(w === null ? null : { which: "preview", width: w })}
              onCommit={(w) => setChrome({ previewW: w })}
            />
          ) : null}
          <ReadingPreview
            key={selected ?? "empty"}
            doc={selectedDoc}
            preview={preview}
            loading={loading}
            error={error}
            resume={chrome.resumeOnOpen}
            onClose={close}
            onMark={mark}
            onProgress={onProgress}
            onReply={reply}
          />
        </div>
      </div>

      <WorkspaceTabBar view={view} onView={setView} />
    </div>
  );
}

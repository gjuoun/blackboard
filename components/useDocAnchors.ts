"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anchor, makeSelector, type QuoteSelector, type TextRange } from "@/lib/anchor";
import type { CodeState } from "@/lib/code-anchor";
import type { RenderedComment } from "@/lib/comment-markdown";
import { buildTextMap, offsetOf, rangeOf } from "@/lib/text-map";
import type { PanelComment } from "./CommentPanel";

/** A passage the reader has selected, in document pixels, ready for the Comment button. */
export type Draft = { selector: QuoteSelector; top: number; left: number };

// CSS Custom Highlight API: Chrome 105+, Safari 17.2+. Absent elsewhere; comments still list.
const highlights = () => (typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null);

/**
 * Anchors every comment to the doc's text and follows the reader: the passages to highlight, the
 * comment under the pointer, the selection a Comment button can post, and the panel's ordering.
 */
export function useDocAnchors({ comments, html, codeState }: { comments: RenderedComment[]; html: string; codeState?: Record<string, CodeState> }) {
  const bodyRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<Record<string, TextRange | null>>({});

  // Anchor every comment against the current text and draw the highlights.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const map = buildTextMap(body);
    const next: Record<string, TextRange | null> = {};
    const open: Range[] = [];
    const active: Range[] = [];
    const hover: Range[] = [];
    for (const c of comments) {
      if (!c.quote) continue;
      const r = anchor(map.text, c.quote);
      next[c.id] = r;
      const range = r && rangeOf(map, r.start, r.end);
      if (!range) continue;
      if (c.id === activeId) active.push(range);
      else if (c.id === hoverId) hover.push(range);
      else if (c.status === "open") open.push(range);
    }
    const hl = highlights();
    if (hl) {
      hl.set("bb-comment", new Highlight(...open));
      hl.set("bb-comment-hover", new Highlight(...hover));
      hl.set("bb-comment-active", new Highlight(...active));
    }
    setAnchors((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [comments, html, activeId, hoverId]);
  useEffect(() => () => highlights()?.clear(), []);

  // Track the reader's selection inside the doc and offer a Comment button next to it.
  useEffect(() => {
    const onChange = () => {
      const body = bodyRef.current;
      const main = mainRef.current;
      const sel = getSelection();
      if (!body || !main || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setDraft(null);
      const range = sel.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return setDraft(null);
      const map = buildTextMap(body);
      const start = offsetOf(map, range.startContainer, range.startOffset);
      const end = offsetOf(map, range.endContainer, range.endOffset);
      if (end <= start || !map.text.slice(start, end).trim()) return setDraft(null);
      const rect = range.getBoundingClientRect();
      const box = main.getBoundingClientRect();
      setDraft({ selector: makeSelector(map.text, start, end), top: rect.bottom - box.top + 6, left: Math.max(0, rect.left - box.left) });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  // Which open comment's passage is under a point, if any (the shortest one when they overlap).
  const hitAt = useCallback(
    (x: number, y: number): string | null => {
      const body = bodyRef.current;
      if (!body) return null;
      const d = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
      const pos = d.caretPositionFromPoint?.(x, y);
      const r = pos ? null : d.caretRangeFromPoint?.(x, y);
      const node = pos?.offsetNode ?? r?.startContainer;
      if (!node || !body.contains(node)) return null;
      const at = offsetOf(buildTextMap(body), node, pos?.offset ?? r?.startOffset ?? 0);
      let best: { id: string; len: number } | null = null;
      for (const c of comments) {
        const range = anchors[c.id];
        if (!range || c.status !== "open" || at < range.start || at >= range.end) continue;
        const len = range.end - range.start;
        if (!best || len < best.len) best = { id: c.id, len };
      }
      return best?.id ?? null;
    },
    [anchors, comments],
  );

  // Hovering a highlight shows a pointer and a stronger highlight, so it reads as clickable.
  const frame = useRef(0);
  const onDocMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const { clientX, clientY } = e;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const id = hitAt(clientX, clientY);
        if (bodyRef.current) bodyRef.current.style.cursor = id ? "pointer" : "";
        setHoverId(id);
      });
    },
    [hitAt],
  );
  const onDocLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setHoverId(null);
  }, []);

  // Clicking highlighted text focuses its comment; clicking plain text clears the focus.
  const onDocClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!getSelection()?.isCollapsed) return;
      const id = hitAt(e.clientX, e.clientY);
      setActiveId(id);
      if (!id) return;
      const item = document.querySelector<HTMLElement>(`[data-testid=comment-item][data-id="${id}"]`);
      item?.scrollIntoView({ block: "center", behavior: "smooth" });
      item?.focus({ preventScroll: true });
      setFlashId(id);
      setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 900);
    },
    [hitAt],
  );

  // Selecting a comment scrolls its passage into view.
  const activate = (id: string) => {
    setActiveId(id);
    const body = bodyRef.current;
    const r = anchors[id];
    if (!body || !r) return;
    const range = rangeOf(buildTextMap(body), r.start, r.end);
    const rect = range?.getBoundingClientRect();
    if (rect && (rect.top < 100 || rect.bottom > innerHeight)) scrollBy({ top: rect.top - innerHeight / 3, behavior: "smooth" });
  };

  // Passage anchors keep their reading order; code anchors follow, by file then line. A drifted
  // code anchor is ordered as usual — it is the badge, not the sort, that reports the drift.
  const panelComments: PanelComment[] = useMemo(() => {
    const withPos = comments.map((c) => {
      const code = c.code ? codeState?.[c.id] : undefined;
      return {
        ...c,
        orphaned: c.quote ? c.id in anchors && anchors[c.id] === null : (code?.orphaned ?? false),
        movedTo: code?.movedTo ?? null,
        pos: c.quote ? (anchors[c.id]?.start ?? Infinity) : Infinity,
      };
    });
    return withPos.sort((a, b) => {
      // independent comments always come last, in the order they were written
      if (a.general !== b.general) return a.general ? 1 : -1;
      if (a.general && b.general) return a.createdAt.localeCompare(b.createdAt);
      if (a.code && b.code) {
        return a.code.path.localeCompare(b.code.path) || a.code.startLine - b.code.startLine || a.createdAt.localeCompare(b.createdAt);
      }
      if (a.code) return 1;
      if (b.code) return -1;
      return a.pos - b.pos;
    });
  }, [comments, anchors, codeState]);

  return { bodyRef, mainRef, draft, setDraft, activeId, flashId, onDocMove, onDocLeave, onDocClick, activate, panelComments };
}

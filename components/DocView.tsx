"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anchor, makeSelector, type QuoteSelector, type TextRange } from "@/lib/anchor";
import type { Comment } from "@/lib/comments-store";
import { buildTextMap, offsetOf, rangeOf } from "@/lib/text-map";
import { CommentPanel, type PanelComment } from "./CommentPanel";
import { DocBody } from "./DocBody";
import { useComments } from "./useComments";

const AUTHOR_KEY = "bb-author";
type Draft = { selector: QuoteSelector; top: number; left: number };

// CSS Custom Highlight API: Chrome 105+, Safari 17.2+. Absent elsewhere; comments still list.
const highlights = () => (typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null);

/**
 * The doc plus its comments. Selection becomes a QuoteSelector over the doc's plain text; each
 * stored selector is anchored back to text offsets and drawn with the CSS Custom Highlight API,
 * which leaves the page DOM untouched.
 */
export function DocView({ board, doc, html, initialComments }: { board: string; doc: string; html: string; initialComments: Comment[] }) {
  const bodyRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [author, setAuthor] = useState("jun");
  useEffect(() => {
    const saved = localStorage.getItem(AUTHOR_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    if (saved) setAuthor(saved);
  }, []);
  const changeAuthor = (v: string) => {
    setAuthor(v);
    localStorage.setItem(AUTHOR_KEY, v.trim() || "jun");
  };

  const { comments, error, add, reply, setResolved } = useComments(board, doc, initialComments, author.trim() || "jun");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composing, setComposing] = useState<QuoteSelector | null>(null);
  const [note, setNote] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [anchors, setAnchors] = useState<Record<string, TextRange | null>>({});

  // Anchor every comment against the current text and draw the highlights.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const map = buildTextMap(body);
    const next: Record<string, TextRange | null> = {};
    const open: Range[] = [];
    const active: Range[] = [];
    for (const c of comments) {
      const r = anchor(map.text, c.quote);
      next[c.id] = r;
      const range = r && rangeOf(map, r.start, r.end);
      if (!range) continue;
      if (c.id === activeId) active.push(range);
      else if (c.status === "open") open.push(range);
    }
    const hl = highlights();
    if (hl) {
      hl.set("bb-comment", new Highlight(...open));
      hl.set("bb-comment-active", new Highlight(...active));
    }
    setAnchors((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [comments, html, activeId]);
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

  const startComment = () => {
    if (!draft) return;
    setComposing(draft.selector);
    setDraft(null);
  };

  const save = async () => {
    if (!composing || !note.trim()) return;
    await add(composing, note.trim());
    setComposing(null);
    setNote("");
    getSelection()?.removeAllRanges();
  };

  // Clicking highlighted text selects its comment.
  const onDocClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const body = bodyRef.current;
      if (!body || !getSelection()?.isCollapsed) return;
      const d = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
      const pos = d.caretPositionFromPoint?.(e.clientX, e.clientY);
      const point = pos ? { node: pos.offsetNode, offset: pos.offset } : (() => { const r = d.caretRangeFromPoint?.(e.clientX, e.clientY); return r ? { node: r.startContainer, offset: r.startOffset } : null; })();
      if (!point) return;
      const at = offsetOf(buildTextMap(body), point.node, point.offset);
      const hit = comments.find((c) => {
        const r = anchors[c.id];
        return r && c.status === "open" && at >= r.start && at <= r.end;
      });
      if (hit) {
        setActiveId(hit.id);
        document.querySelector(`[data-testid=comment-item][data-id="${hit.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    },
    [anchors, comments],
  );

  // Selecting a comment scrolls its passage into view.
  const activate = (id: string) => {
    setActiveId(id);
    const body = bodyRef.current;
    const r = anchors[id];
    if (!body || !r) return;
    const range = rangeOf(buildTextMap(body), r.start, r.end);
    const rect = range?.getBoundingClientRect();
    if (rect && (rect.top < 60 || rect.bottom > innerHeight)) scrollBy({ top: rect.top - innerHeight / 3, behavior: "smooth" });
  };

  const panelComments: PanelComment[] = useMemo(() => {
    const withPos = comments.map((c) => ({ ...c, orphaned: c.id in anchors && anchors[c.id] === null, pos: anchors[c.id]?.start ?? Infinity }));
    return withPos.sort((a, b) => a.pos - b.pos);
  }, [comments, anchors]);

  const composer = composing ? (
    <div className="composer">
      <blockquote className="comment-quote">{composing.exact.replace(/\s+/g, " ").trim()}</blockquote>
      <textarea
        data-testid="comment-input"
        autoFocus
        rows={3}
        placeholder="Comment…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === "Escape") setComposing(null);
        }}
      />
      <div className="composer-actions">
        <button onClick={() => setComposing(null)}>Cancel</button>
        <button data-testid="comment-save" className="primary" onClick={save} disabled={!note.trim()}>
          Comment
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <main className="doc-main" ref={mainRef}>
        <DocBody html={html} ref={bodyRef} onClick={onDocClick} />
        {draft ? (
          <button
            data-testid="comment-button"
            className="comment-button primary"
            style={{ top: draft.top, left: draft.left }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startComment}
          >
            Comment
          </button>
        ) : null}
      </main>
      <CommentPanel
        comments={panelComments}
        activeId={activeId}
        onActivate={activate}
        onReply={reply}
        onResolve={setResolved}
        showResolved={showResolved}
        onShowResolved={setShowResolved}
        author={author}
        onAuthor={changeAuthor}
        composer={composer}
        error={error}
      />
    </>
  );
}

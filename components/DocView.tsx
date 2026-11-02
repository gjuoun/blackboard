"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useEffect, useState, type ReactNode } from "react";
import type { QuoteSelector } from "@/lib/anchor";
import type { CodeState } from "@/lib/code-anchor";
import type { RenderedComment } from "@/lib/comment-markdown";
import type { Review } from "@/lib/comments-store";
import { cn } from "@/lib/utils";
import { clampPanels, type PanelKey, type RightTab } from "@/lib/prefs";
import { DESKTOP, patchDoc, setChrome, useChrome, useIsDesktop } from "./chrome";
import { PanelResizer } from "./PanelResizer";
import { RightTabs } from "./RightTabs";
import { CommentPanel } from "./CommentPanel";
import { ComposerLine } from "./ComposerLine";
import { DocBody } from "./DocBody";
import { PassageComposer } from "./PassageComposer";
import { useComments } from "./useComments";
import { useDocAnchors } from "./useDocAnchors";
import { useLiveDoc } from "./useLiveDoc";

const AUTHOR_KEY = "bb-author";
/** The Local PR half of the shared right column, rendered by the server page. */
type DiffRail = {
  panel: ReactNode;
  commentHref: string;
  prHref: string;
  additions: number;
  deletions: number;
  /** False for a plain document: the rail keeps its single Comments tab and never offers the diff. */
  showPr?: boolean;
};
/** The File tab: the raw source pane, and the href that selects it. */
export type FileRail = { panel: ReactNode; href: string; commentHref: string };
type DocViewProps = {
  session: string;
  /** This doc's review rounds, listed after the anchored comments. */
  reviews?: Review[];
  /** Set on every document with source (doc, code, stream): the right rail gets a File tab. */
  fileRail?: FileRail;
  title: string;
  path: string;
  html: string;
  initialComments: RenderedComment[];
  header: ReactNode;
  toc: ReactNode;
  rightTab?: RightTab;
  diff?: DiffRail;
  /** Per code-anchored comment: whether its line still reads as it did, and where it moved to. */
  codeState?: Record<string, CodeState>;
};

/**
 * The doc plus its comments. The anchoring and selection half lives in `useDocAnchors`; this
 * component owns the layout: the three columns on desktop, the bottom sheets on a phone.
 */
export function DocView({ session, reviews = [], title, path, html, initialComments, header, toc, rightTab = "comments", diff, codeState, fileRail }: DocViewProps) {
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

  const { comments, error, add, addGeneral, reply, setResolved, reload, edit, remove, editReply, removeReply } = useComments(session, initialComments, author.trim() || "jun");
  const chrome = useChrome();
  const desktop = useIsDesktop();
  useLiveDoc(session, reload);
  const openCount = comments.filter((c) => c.status === "open").length;
  // A file link selects Local PR in the URL; a phone has no right rail, so open the existing
  // bottom sheet for that pane instead of inventing another panel.
  const activeTab: RightTab = fileRail && rightTab === "file" ? "file" : diff && rightTab === "pr" ? "pr" : "comments";
  useEffect(() => {
    if (!desktop && activeTab === "pr") setChrome({ sheet: "cm" });
  }, [desktop, activeTab]);
  useEffect(() => patchDoc({ open: openCount }), [openCount, chrome.doc?.id]);
  const [composing, setComposing] = useState<QuoteSelector | null>(null);
  const [note, setNote] = useState("");
  const showResolved = chrome.showResolved;
  const setShowResolved = (v: boolean) => setChrome({ showResolved: v });
  // The width being dragged right now. It stays local until the pointer is released, so the
  // column can follow the grip frame by frame without a localStorage write per pixel.
  const [resizing, setResizing] = useState<{ which: PanelKey; width: number } | null>(null);

  // A narrower window must not leave the doc behind two wide panels: re-clamp both widths. Only a
  // desktop viewport gets this: a phone shows no side panels, and clamping there would overwrite the
  // widths the reader chose on desktop.
  useEffect(() => {
    const onResize = () => {
      if (!matchMedia(DESKTOP).matches) return;
      const next = clampPanels({ tocW: chrome.tocW, cmW: chrome.cmW }, innerWidth);
      if (next.tocW !== chrome.tocW || next.cmW !== chrome.cmW) setChrome(next);
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [chrome.tocW, chrome.cmW]);

  const { bodyRef, mainRef, draft, setDraft, activeId, flashId, onDocMove, onDocLeave, onDocClick, activate, panelComments } = useDocAnchors({ comments, html, codeState });

  const startComment = () => {
    if (!draft) return;
    setComposing(draft.selector);
    setDraft(null);
    setChrome(desktop ? { cmOpen: true } : { sheet: "cm" });
  };

  const save = async () => {
    if (!composing || !note.trim()) return;
    await add(composing, note.trim());
    setComposing(null);
    setNote("");
    getSelection()?.removeAllRanges();
  };

  // The one-line composer sits at the top of the Comments pane. With a passage selected it posts a passage
  // comment; with none it posts an independent (general) comment.
  const lineComposer = (
    <ComposerLine
      onSend={async (text, images) => {
        if (composing) {
          await add(composing, text, images);
          setComposing(null);
          getSelection()?.removeAllRanges();
        } else {
          await addGeneral(text, images);
        }
      }}
    />
  );
  const composer = <PassageComposer composing={composing} note={note} onNote={setNote} onCancel={() => setComposing(null)} onSave={() => void save()} />;

  const panel = (
    <CommentPanel
      reviews={reviews}
      title={title}
      path={path}
      comments={panelComments}
      activeId={activeId}
      flashId={flashId}
      onActivate={activate}
      onReply={reply}
      onResolve={setResolved}
      onEdit={edit}
      onDelete={remove}
      onEditReply={editReply}
      onDeleteReply={removeReply}
      showResolved={showResolved}
      onShowResolved={setShowResolved}
      author={author}
      onAuthor={changeAuthor}
      composer={<>{lineComposer}{composer}</>}
      error={error}
    />
  );

  // Desktop: Contents | doc | Comments, each side column collapsing (Comments to a thin rail).
  // Phone: the doc alone, with Contents and Comments as bottom sheets opened from the top bar.
  // The column template is CSS (`.doc-grid`) and the side panels are hidden below 768px by CSS too,
  // so the first paint, before any script runs, lays out the same way the viewport does. The columns
  // read the variables the boot script put on <html>, so stored widths paint on the first frame; an
  // inline override is only needed when a panel is closed.
  const tocW = resizing?.which === "toc" ? resizing.width : chrome.tocW;
  const cmW = resizing?.which === "cm" ? resizing.width : chrome.cmW;
  const vars: Record<string, string> = {};
  if (desktop) {
    if (!(chrome.tocOpen && toc)) vars["--toc-w"] = "0px";
    else if (resizing?.which === "toc") vars["--toc-w"] = resizing.width + "px";
    if (!chrome.cmOpen) vars["--cm-w"] = "0px";
    else if (resizing?.which === "cm") vars["--cm-w"] = resizing.width + "px";
  }
  return (
    <div className="doc-grid grid min-h-[calc(100vh-var(--bar-h))] transition-[grid-template-columns] duration-200 [html[data-resizing]_&]:transition-none" style={vars as React.CSSProperties}>
      {desktop ? (
        <aside className={cn("hidden border-border relative overflow-x-clip border-r md:block", chrome.tocOpen && toc ? "" : "invisible border-0")} aria-hidden={!chrome.tocOpen} data-testid="toc-panel">
          {/* No top padding: the left rail's tab strip must sit flush under the top bar, exactly like the
              right rail's. A p-3 wrapper here put 12px above the tabs and read as a stray gap. */}
          <div className="sticky top-[var(--bar-h)] max-h-[calc(100vh-var(--bar-h))] overflow-y-auto px-3 pb-3">{toc}</div>
          <PanelResizer
            which="toc"
            width={tocW}
            other={chrome.cmOpen ? cmW : 0}
            onDraft={(w) => setResizing(w === null ? null : { which: "toc", width: w })}
            onCommit={(w) => setChrome({ tocW: w })}
          />
        </aside>
      ) : null}
      <main className="relative min-w-0 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] max-md:pt-[calc(env(safe-area-inset-top)+0.75rem)] md:px-10 md:pt-8 md:pb-24" ref={mainRef}>
        <div className="mx-auto min-w-0 max-w-[760px]">
          {header}
          <DocBody html={html} ref={bodyRef} onClick={onDocClick} onMouseMove={onDocMove} onMouseLeave={onDocLeave} />
        </div>
        {draft ? (
          <Button
            size="sm"
            data-testid="comment-button"
            className="absolute z-5 shadow-md"
            style={{ top: draft.top, left: draft.left }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startComment}
          >
            Comment
          </Button>
        ) : null}
      </main>
      {desktop ? (
        chrome.cmOpen ? (
          <aside className="hidden border-border bg-background relative border-l md:block" data-testid="comments-panel" data-tab={activeTab}>
            <div className="sticky top-[var(--bar-h)] flex max-h-[calc(100vh-var(--bar-h))] flex-col">
              {diff || fileRail ? (
                <RightTabs active={activeTab} commentHref={diff?.commentHref ?? fileRail!.commentHref} prHref={diff?.prHref ?? ""} open={openCount} additions={diff?.additions ?? 0} deletions={diff?.deletions ?? 0} showPr={diff ? (diff.showPr ?? true) : false} fileHref={fileRail?.href} />
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto p-3.5" data-testid={activeTab === "pr" && diff ? "diff-pane" : activeTab === "file" && fileRail ? "file-pane" : "comments-pane"}>
                {activeTab === "file" && fileRail ? fileRail.panel : activeTab === "pr" && diff ? diff.panel : panel}
              </div>
            </div>
            <PanelResizer
              which="cm"
              width={cmW}
              other={chrome.tocOpen && toc ? tocW : 0}
              onDraft={(w) => setResizing(w === null ? null : { which: "cm", width: w })}
              onCommit={(w) => setChrome({ cmW: w })}
            />
          </aside>
        ) : (
          // Collapsed means gone: the Comments / Local PR buttons in the top bar bring it back.
          <aside aria-hidden className="hidden invisible md:block" />
        )
      ) : (
        <>
          <Sheet open={chrome.sheet === "toc"} onOpenChange={(o) => setChrome({ sheet: o ? "toc" : null })}>
            <SheetContent side="bottom" showCloseButton={false} className="bg-background max-h-[75vh] overflow-y-auto rounded-t-2xl px-4 pt-2 pb-8">
              <div className="bg-border mx-auto mb-3 h-1 w-10 shrink-0 rounded-full" aria-hidden />
              <SheetTitle className="sr-only">Contents</SheetTitle>
              <SheetDescription className="sr-only">Jump to a section</SheetDescription>
              <div onClick={(e) => (e.target as HTMLElement).closest("a") && setChrome({ sheet: null })}>{toc}</div>
            </SheetContent>
          </Sheet>
          <Sheet open={chrome.sheet === "cm"} onOpenChange={(o) => setChrome({ sheet: o ? "cm" : null })}>
            <SheetContent side="bottom" showCloseButton={false} className="bg-background max-h-[80vh] overflow-y-auto rounded-t-2xl px-4 pt-2 pb-8">
              <div className="bg-border mx-auto mb-3 h-1 w-10 shrink-0 rounded-full" aria-hidden />
              <SheetTitle className="sr-only">{activeTab === "pr" && diff ? "Local PR" : "Comments"}</SheetTitle>
              <SheetDescription className="sr-only">Comments and local changes on this document</SheetDescription>
              {diff ? (
                <div className="mb-3">
                  <RightTabs active={activeTab} commentHref={diff.commentHref} prHref={diff.prHref} open={openCount} additions={diff.additions} deletions={diff.deletions} showPr={diff.showPr ?? true} />
                </div>
              ) : null}
              {activeTab === "pr" && diff ? diff.panel : panel}
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Home, X } from "lucide-react";
import { moveTab, SCRATCHPAD_TAB, type Tab } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { getTabs, setTabs } from "./tabs-store";

/** The desktop tab strip: the pinned Home tab, one tab per open doc, drag to reorder. */
export function TabStrip({ tabs, active, onHome, onClose }: { tabs: Tab[]; active: string | null; onHome: boolean; onClose: (id: string) => void }) {
  // Drag a tab to reorder: `drag.id` is the tab in hand, `mark` the edge it would land on.
  const [drag, setDrag] = useState<{ id: string; mark: { id: string; side: "before" | "after" } | null } | null>(null);
  const dropBefore = (mark: { id: string; side: "before" | "after" }) => (mark.side === "before" ? mark.id : (tabs[tabs.findIndex((t) => t.id === mark.id) + 1]?.id ?? null));
  const endDrag = () => setDrag(null);

  return (
    // The pinned Home tab is the way back to the list
    <nav
      className="scrollbar-none hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex"
      aria-label="Open documents"
      onDragOver={(e) => drag && e.preventDefault()}
      onDrop={(e) => {
        // A drop on the empty strip after the last tab sends the tab to the end.
        if (e.target !== e.currentTarget || !drag) return;
        e.preventDefault();
        setTabs(moveTab(getTabs(), drag.id, null));
        endDrag();
      }}
    >
      <Link
        href="/"
        data-testid="tab-home"
        aria-current={onHome ? "page" : undefined}
        title="Home"
        className={cn("text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center rounded-lg border border-transparent px-3 text-sm", onHome && "bg-card text-foreground border-border shadow-xs")}
      >
        <Home className="size-4" />
      </Link>
      {tabs.map((t) => (
        <div
          key={t.id}
          data-testid="tab"
          data-id={t.id}
          data-kind={t.id === SCRATCHPAD_TAB ? "scratchpad" : "doc"}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", t.id);
            setDrag({ id: t.id, mark: null });
          }}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
            if (drag.mark?.id !== t.id || drag.mark.side !== side) setDrag({ ...drag, mark: { id: t.id, side } });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag?.mark) setTabs(moveTab(getTabs(), drag.id, dropBefore(drag.mark)));
            endDrag();
          }}
          onDragEnd={endDrag}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            onClose(t.id);
          }}
          className={cn("group text-muted-foreground hover:text-foreground relative flex h-8 max-w-56 shrink-0 items-center rounded-lg border border-transparent text-sm", t.id === active && "bg-card text-foreground border-border font-medium shadow-xs", drag?.id === t.id && "opacity-40", drag?.mark?.id === t.id && drag.id !== t.id && (drag.mark.side === "before" ? "before:bg-primary before:absolute before:-left-1 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full" : "after:bg-primary after:absolute after:-right-1 after:top-1 after:bottom-1 after:w-0.5 after:rounded-full"))}
        >
          <Link href={`/s/${t.id}`} title={t.path ?? t.title} aria-current={t.id === active ? "page" : undefined} className="min-w-0 truncate py-1 pr-1 pl-3">
            {t.title}
          </Link>
          <button type="button" data-testid="tab-close" aria-label={`Close ${t.title}`} title="Close" onClick={() => onClose(t.id)} className="text-muted-foreground hover:bg-accent hover:text-foreground mr-1 grid size-5 shrink-0 place-items-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </nav>
  );
}

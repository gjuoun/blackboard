"use client";

import Link from "next/link";
import { Search, Settings } from "lucide-react";
import { useState } from "react";
import type { WorkspaceCounts } from "@/lib/reading-model";
import { VIEW_FILTERS, type WorkspaceView } from "./WorkspaceTabBar";

const VIEW_TITLES: Record<WorkspaceView, string> = { all: "Inbox", unread: "Inbox", reading: "Inbox", new: "New", settings: "Settings" };

/**
 * The workspace's top bar. Desktop: search, the open-comment count, and the one-click way to clear
 * the inbox. Phone: the view's brand, the live counts and a search icon that expands the input —
 * the row the mobile sketch draws above the list.
 */
export function ReadingHeader({
  query,
  onQuery,
  pending,
  counts,
  view,
  onMarkAll,
}: {
  query: string;
  onQuery: (value: string) => void;
  pending: number;
  counts: WorkspaceCounts;
  view: WorkspaceView;
  onMarkAll: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const input = (
    <label className="relative min-w-0 flex-1 md:flex-none">
      <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search documents"
        className="border-input bg-card placeholder:text-muted-foreground focus:border-primary h-[30px] w-full rounded-lg border pr-2 pl-8 text-xs outline-none md:w-[220px]"
      />
    </label>
  );

  return (
    <div data-testid="rw-header" className="border-border flex flex-none flex-col md:h-[52px] md:flex-row md:items-center md:gap-2 md:px-3.5">
      {/* Phone row: brand, the counts and the search toggle — same anatomy as the sketch's `.mbar`. */}
      <div className="flex h-[52px] items-center gap-2 px-3.5 md:hidden">
        <span className="flex items-center gap-2 text-[15px] font-bold">
          <span className="bg-primary size-2.5 rotate-45 rounded-[2px]" aria-hidden />
          {VIEW_TITLES[view]}
        </span>
        <span className="flex-1" />
        <span data-testid="rw-count-line-mobile" className="text-muted-foreground font-mono text-[10.5px] whitespace-nowrap">
          {view === "settings" ? "Global" : `${counts.unread} unread · ${counts.reading} reading`}
        </span>
        {VIEW_FILTERS[view] !== undefined ? (
        <button
          type="button"
          data-testid="rw-search-toggle"
          aria-label="Search"
          aria-expanded={searchOpen}
          title="Search"
          onClick={() => setSearchOpen((v) => !v)}
          className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[34px] place-items-center rounded-[9px]"
        >
          <Search className="size-[17px]" />
          </button>
        ) : null}
      </div>
      {searchOpen ? <div className="px-3.5 pb-2 md:hidden">{input}</div> : null}

      {/* Desktop row: the bar as it was. */}
      <span className="hidden items-center gap-2 text-[13px] md:flex">
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Reading workspace</span>
      </span>
      <div className="ml-auto hidden items-center gap-1.5 md:flex">
        {input}
        <span data-testid="rw-pending" className="border-border bg-card text-muted-foreground hidden h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] sm:inline-flex">
          <span className="bg-primary-soft text-primary rounded-full px-1.5 font-mono text-[10.5px] leading-[17px]">{pending}</span>
          awaiting replies
        </span>
        <button type="button" data-testid="rw-mark-all" onClick={onMarkAll} className="bg-primary text-primary-foreground h-[30px] rounded-lg px-2.5 text-[12.5px] hover:brightness-105">
          Mark all read
        </button>
        <Link
          href="/workspace/settings"
          aria-label="Workspace settings"
          title="Settings"
          data-testid="rw-settings-gear"
          className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[30px] place-items-center rounded-lg"
        >
          <Settings className="size-4" />
        </Link>
      </div>
    </div>
  );
}

"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import type { WorkspaceCounts } from "@/lib/reading-model";
import { VIEW_FILTERS, type WorkspaceView } from "./WorkspaceTabBar";

const VIEW_TITLES: Record<WorkspaceView, string> = { all: "Inbox", unread: "Inbox", reading: "Inbox", new: "New", settings: "Settings" };

/**
 * The workspace header on a phone: the view's brand, the live counts and a search icon that
 * expands the input — the row the mobile sketch draws above the list. On desktop the inbox
 * controls ride inside the top bar instead (WorkspaceBarControls), so this renders nothing.
 */
export function ReadingHeader({
  query,
  onQuery,
  counts,
  view,
}: {
  query: string;
  onQuery: (value: string) => void;
  counts: WorkspaceCounts;
  view: WorkspaceView;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const input = (
    <label className="relative min-w-0 flex-1">
      <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search documents"
        className="border-input bg-card placeholder:text-muted-foreground focus:border-primary h-[30px] w-full rounded-lg border pr-2 pl-8 text-xs outline-none"
      />
    </label>
  );

  return (
    <div data-testid="rw-header" className="border-border flex-none md:hidden">
      {/* Phone row: brand, the counts and the search toggle — same anatomy as the sketch's `.mbar`. */}
      <div className="flex h-[52px] items-center gap-2 px-3.5">
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
      {searchOpen ? <div className="px-3.5 pb-2">{input}</div> : null}
    </div>
  );
}

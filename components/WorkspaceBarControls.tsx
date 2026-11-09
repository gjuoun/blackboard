"use client";

import Link from "next/link";
import { Search, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspaceBar } from "./workspace-bar";

const FILTERS = [
  { key: "all", label: "All documents" },
  { key: "unread", label: "Unread" },
  { key: "reading", label: "Reading" },
] as const;

/**
 * The desktop inbox controls folded into the top bar on `/workspace` — the merged row that
 * replaced ReadingHeader and ReadingToolbar there. Collapses in order as the width tightens:
 * the breadcrumb and the "awaiting replies" label go below xl, the counts and the inline search
 * input go below lg (the input moves into a popover). Renders nothing until the page publishes
 * its bar props, so the settings page and SSR see no leftovers.
 */
export function WorkspaceBarControls() {
  const bar = useWorkspaceBar();
  if (!bar) return null;

  const input = (
    <label className="relative min-w-0">
      <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <input
        value={bar.query}
        onChange={(e) => bar.onQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search documents"
        className="border-input bg-card placeholder:text-muted-foreground focus:border-primary h-[30px] w-[200px] rounded-lg border pr-2 pl-8 text-xs outline-none"
      />
    </label>
  );

  return (
    <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
      {/* Breadcrumb: the first element to drop, below xl. */}
      <span className="hidden shrink-0 items-center gap-2 text-[13px] xl:flex">
        <span className="text-muted-foreground">/</span>
        <span className="font-medium whitespace-nowrap">Reading workspace</span>
      </span>

      {/* Status filters only exist below lg — from lg the left rail carries them. */}
      <div className="flex shrink-0 items-center gap-1 lg:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            data-filter={f.key}
            aria-pressed={bar.filter === f.key}
            onClick={() => bar.onFilter(f.key)}
            className={`rounded-lg px-2 py-1 text-xs whitespace-nowrap ${bar.filter === f.key ? "bg-primary-soft text-primary font-semibold" : "text-muted-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <select
        value={bar.repo}
        onChange={(e) => bar.onRepo(e.target.value)}
        aria-label="Filter by repository"
        className="border-input bg-card h-[30px] shrink-0 rounded-lg border px-2.5 text-xs"
      >
        <option value="">All repos</option>
        {bar.repos.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {/* Counts drop below lg, after the breadcrumb. */}
      <span data-testid="rw-count-line" className="text-muted-foreground hidden shrink-0 font-mono text-[11.5px] whitespace-nowrap lg:block">
        {bar.counts.unread} unread · {bar.counts.reading} reading
      </span>

      <span className="min-w-0 flex-1" />

      {/* Inline search from lg; below lg the same input sits in a popover behind an icon. */}
      <span className="hidden lg:block">{input}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="rw-search"
            aria-label="Search"
            title="Search"
            className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[30px] shrink-0 place-items-center rounded-lg lg:hidden"
          >
            <Search className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[260px] p-2">
          {input}
        </PopoverContent>
      </Popover>

      {/* The label drops below xl; the count stays. */}
      <span data-testid="rw-pending" className="border-border bg-card text-muted-foreground inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]">
        <span className="bg-primary-soft text-primary rounded-full px-1.5 font-mono text-[10.5px] leading-[17px]">{bar.pending}</span>
        <span className="hidden whitespace-nowrap xl:inline">awaiting replies</span>
      </span>

      <button type="button" data-testid="rw-mark-all" onClick={bar.onMarkAll} className="bg-primary text-primary-foreground h-[30px] shrink-0 rounded-lg px-2.5 text-[12.5px] whitespace-nowrap hover:brightness-105">
        Mark all read
      </button>
      <Link
        href="/workspace/settings"
        aria-label="Workspace settings"
        title="Settings"
        data-testid="rw-settings-gear"
        className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[30px] shrink-0 place-items-center rounded-lg"
      >
        <Settings className="size-4" />
      </Link>
    </div>
  );
}

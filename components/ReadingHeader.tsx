"use client";

import { Search } from "lucide-react";

/** The workspace's top bar: search, the open-comment count, and the one-click way to clear the inbox. */
export function ReadingHeader({
  query,
  onQuery,
  pending,
  onMarkAll,
}: {
  query: string;
  onQuery: (value: string) => void;
  pending: number;
  onMarkAll: () => void;
}) {
  return (
    <div className="border-border flex h-[52px] flex-none items-center gap-2 px-3.5">
      <span className="text-muted-foreground text-[13px]">/</span>
      <span className="text-[13px] font-medium">Reading workspace</span>
      <div className="ml-auto flex items-center gap-1.5">
        <label className="relative">
          <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search documents"
            className="border-input bg-card placeholder:text-muted-foreground focus:border-primary h-[30px] w-[180px] rounded-lg border pr-2 pl-8 text-xs outline-none sm:w-[220px]"
          />
        </label>
        <span data-testid="rw-pending" className="border-border bg-card text-muted-foreground hidden h-[30px] items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] sm:inline-flex">
          <span className="bg-primary-soft text-primary rounded-full px-1.5 font-mono text-[10.5px] leading-[17px]">{pending}</span>
          awaiting replies
        </span>
        <button type="button" data-testid="rw-mark-all" onClick={onMarkAll} className="bg-primary text-primary-foreground h-[30px] rounded-lg px-2.5 text-[12.5px] hover:brightness-105">
          Mark all read
        </button>
      </div>
    </div>
  );
}

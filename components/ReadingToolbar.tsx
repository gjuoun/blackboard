"use client";

import type { WorkspaceCounts } from "@/lib/reading-model";

/** The list toolbar: the repo filter and the live counts. Desktop only — a phone filters from the bottom tab bar. */
export function ReadingToolbar({
  filter,
  onFilter,
  repos,
  repo,
  onRepo,
  counts,
}: {
  filter: string;
  onFilter: (value: "all" | "unread" | "reading") => void;
  repos: string[];
  repo: string;
  onRepo: (value: string) => void;
  counts: WorkspaceCounts;
}) {
  return (
    <div className="border-border bg-background/95 hidden flex-none items-center gap-2 border-b px-[18px] py-3 md:flex">
      <div className="flex items-center gap-1 lg:hidden">
        {(
          [
            { key: "all", label: "All documents" },
            { key: "unread", label: "Unread" },
            { key: "reading", label: "Reading" },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            data-mobile-filter={f.key}
            aria-pressed={filter === f.key}
            onClick={() => onFilter(f.key)}
            className={`rounded-lg px-2 py-1 text-xs ${filter === f.key ? "bg-primary-soft text-primary font-semibold" : "text-muted-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <select value={repo} onChange={(e) => onRepo(e.target.value)} aria-label="Filter by repository" className="border-input bg-card h-8 rounded-lg border px-2.5 text-xs">
        <option value="">All repos</option>
        {repos.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <span className="flex-1" />
      <span data-testid="rw-count-line" className="text-muted-foreground font-mono text-[11.5px] whitespace-nowrap">
        {counts.unread} unread · {counts.reading} reading
      </span>
    </div>
  );
}

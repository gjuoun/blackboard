"use client";

import type { WorkspaceCounts } from "@/lib/reading-model";

/** The list toolbar: a repo filter (status filters too on narrow screens) and the live counts. */
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
  const filters = [
    { key: "all", label: "All documents" },
    { key: "unread", label: "Unread" },
    { key: "reading", label: "Reading" },
  ] as const;
  return (
    <div className="border-border bg-background/95 flex flex-none items-center gap-2 border-b px-[18px] py-3">
      <div className="flex items-center gap-1 lg:hidden">
        {filters.map((f) => (
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

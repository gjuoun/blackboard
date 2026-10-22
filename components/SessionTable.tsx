"use client";

import Link from "next/link";
import { useState } from "react";
import { PenLine, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HOME_GROUPS, type HomeGroup } from "@/lib/home-groups";
import { cn } from "@/lib/utils";

export type HomeSort = "updated" | "created" | "title";
export type HomeRow = {
  id: string;
  title: string;
  location: string;
  path: string;
  repo: string | null;
  branch: string | null;
  open: number;
  missing: boolean;
  createdAt: string;
  /** Pre-formatted on the server, so the client renders the same text. */
  created: string;
  updatedAt: string;
  updated: string;
  group: HomeGroup;
};

/** Filter value for files outside any git repo. */
export const NO_REPO = "__none";

const SORTS: { value: HomeSort; label: string }[] = [
  { value: "updated", label: "Newest first" },
  { value: "created", label: "Created" },
  { value: "title", label: "Title" },
];

export function filterRows(rows: HomeRow[], q: string, repo: string, sort: HomeSort): HomeRow[] {
  const needle = q.trim().toLowerCase();
  return rows
    .filter((r) => !repo || (repo === NO_REPO ? r.repo === null : r.repo === repo))
    .filter((r) => !needle || [r.title, r.location, r.path, r.branch ?? "", r.repo ?? ""].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, b) =>
      sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
}

/**
 * The session list: search, a repo filter and a sort above a table. The choices live in the URL
 * query (replaced, not pushed), so they survive a reload and coming back to Home.
 */
export function SessionTable({ rows, pad, initial }: { rows: HomeRow[]; pad: { href: string; summary: string }; initial: { q: string; repo: string; sort: HomeSort } }) {
  const [q, setQ] = useState(initial.q);
  const [repo, setRepo] = useState(initial.repo);
  const [sort, setSort] = useState<HomeSort>(initial.sort);

  const sync = (next: { q?: string; repo?: string; sort?: HomeSort }) => {
    const v = { q, repo, sort, ...next };
    const p = new URLSearchParams();
    if (v.q.trim()) p.set("q", v.q.trim());
    if (v.repo) p.set("repo", v.repo);
    if (v.sort !== "updated") p.set("sort", v.sort);
    const qs = p.toString();
    history.replaceState(history.state, "", qs ? `/?${qs}` : "/");
  };

  const repos = [...new Set(rows.map((r) => r.repo).filter((r): r is string => r !== null))].sort();
  const hasLoose = rows.some((r) => r.repo === null);
  const visible = filterRows(rows, q, repo, sort);

  const field = "border-input bg-card focus-visible:ring-ring/40 h-9 rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]";
  const card = (r: HomeRow) => (
    <Link
      key={r.id}
      href={`/s/${r.id}`}
      data-testid="session-row"
      data-id={r.id}
      className="bg-card border-border hover:border-primary/40 flex min-w-0 flex-col gap-1.5 rounded-xl border p-4 transition-shadow hover:shadow-md"
    >
      <span className="text-[15.5px] leading-snug font-semibold">
        {r.title}
        {r.missing ? <Badge variant="destructive" className="ml-2 align-middle">missing</Badge> : null}
      </span>
      {/* Path is cut from the left, so the file name always shows. */}
      <span className="text-muted-foreground block truncate text-left font-mono text-xs [direction:rtl]" title={r.path}>
        <bdi>{r.location}</bdi>
      </span>
      <span className="text-muted-foreground mt-1 flex h-5 items-center justify-between gap-2 font-mono text-xs">
        <span className="truncate">
          {r.branch ? `⎇ ${r.branch} · ` : ""}
          <span title={r.updatedAt}>{r.updated}</span>
        </span>
        {r.open > 0 ? <Badge className="bg-primary-soft text-primary shrink-0 hover:bg-primary-soft">💬 {r.open}</Badge> : <span className="opacity-40">0</span>}
      </span>
    </Link>
  );
  const padCard = (
    <Link
      href={pad.href}
      data-testid="scratchpad-card"
      className="bg-primary-soft border-primary/20 hover:border-primary/50 flex min-w-0 flex-col gap-1.5 rounded-xl border p-4 transition-shadow hover:shadow-md"
    >
      <span className="flex items-center gap-2 text-[15.5px] font-semibold">
        <PenLine className="text-primary size-4" /> Scratchpad
      </span>
      <span className="text-muted-foreground text-xs">{pad.summary}</span>
    </Link>
  );
  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
  const grouped = sort !== "title";

  return (
    <section className="sessions">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground flex-1 basis-full font-mono text-sm sm:basis-auto" data-testid="session-count">
          {visible.length === rows.length ? `${rows.length} ${rows.length === 1 ? "session" : "sessions"}` : `${visible.length} of ${rows.length}`}
        </span>
        <label className="relative min-w-0 basis-full sm:flex-none sm:basis-auto">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <input
            className={cn(field, "w-full pl-8 sm:w-60")}
            data-testid="session-search"
            type="search"
            placeholder="Search sessions"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              sync({ q: e.target.value });
            }}
          />
        </label>
        <select
          aria-label="Filter by repo"
          className={cn(field, "min-w-0 flex-1 sm:flex-none")}
          data-testid="repo-filter"
          value={repo}
          onChange={(e) => {
            setRepo(e.target.value);
            sync({ repo: e.target.value });
          }}
        >
          <option value="">All repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          {hasLoose ? <option value={NO_REPO}>No repo</option> : null}
        </select>
        <select
          aria-label="Sort"
          className={cn(field, "min-w-0 flex-1 sm:flex-none")}
          data-testid="sort-select"
          value={sort}
          onChange={(e) => {
            const s = e.target.value as HomeSort;
            setSort(s);
            sync({ sort: s });
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className={cn(grid, "mb-2")}>{padCard}</div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm" data-testid="sessions-empty">
          No sessions yet. Open a markdown file with <code className="bg-code rounded px-1.5">blackboard open &lt;file&gt;</code>.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground border-border mt-4 rounded-xl border border-dashed p-8 text-center text-sm">No sessions match.</p>
      ) : grouped ? (
        HOME_GROUPS.map((g) => {
          const items = visible.filter((r) => r.group === g);
          return items.length ? (
            <div key={g}>
              <h2 className="text-muted-foreground mt-6 mb-2 text-xs font-medium">{g}</h2>
              <div className={grid}>{items.map(card)}</div>
            </div>
          ) : null;
        })
      ) : (
        <div className={cn(grid, "mt-6")}>{visible.map(card)}</div>
      )}
    </section>
  );
}

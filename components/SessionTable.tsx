"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
export function SessionTable({ rows, initial }: { rows: HomeRow[]; initial: { q: string; repo: string; sort: HomeSort } }) {
  const router = useRouter();
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

  return (
    <section className="sessions">
      <div className="sessions-bar">
        <span className="sessions-count" data-testid="session-count">
          {visible.length === rows.length ? `${rows.length} ${rows.length === 1 ? "session" : "sessions"}` : `${visible.length} of ${rows.length}`}
        </span>
        <input
          className="session-search"
          data-testid="session-search"
          type="search"
          placeholder="Search sessions"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            sync({ q: e.target.value });
          }}
        />
        <label className="ctl">
          <span>Filter</span>
          <select
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
        </label>
        <label className="ctl">
          <span>Sort</span>
          <select
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
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="muted sessions-empty" data-testid="sessions-empty">
          No sessions yet. Open a markdown file with <code>blackboard open &lt;file&gt;</code>.
        </p>
      ) : (
        <div className="session-table-wrap">
          <table className="session-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Branch</th>
                <th className="num">Comments</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} data-testid="session-row" data-id={r.id} onClick={() => router.push(`/s/${r.id}`)}>
                  <td className="title-cell">
                    <Link href={`/s/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      {r.title}
                    </Link>
                    {r.missing ? <span className="missing-badge">missing</span> : null}
                    <div className="location muted" title={r.path}>
                      {r.location}
                    </div>
                  </td>
                  <td className="mono">{r.branch ?? <span className="muted">—</span>}</td>
                  <td className="num mono">{r.open > 0 ? r.open : <span className="muted">0</span>}</td>
                  <td className="mono">{r.created}</td>
                  <td className="mono" title={r.updatedAt}>
                    {r.updated}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 ? <p className="muted sessions-empty">No sessions match.</p> : null}
        </div>
      )}
    </section>
  );
}

import Link from "next/link";
import type { SessionRow } from "@/lib/sessions";

/** Above a doc: its title, where the file lives (repo / path, or the absolute path) and its branch. */
export function DocHeader({ row }: { row: SessionRow }) {
  return (
    <header className="top-nav doc-head">
      <Link href="/">Blackboard</Link>
      <span className="crumb">/</span>
      <strong className="doc-title" data-testid="doc-title">
        {row.title}
      </strong>
      <span className="doc-location muted" data-testid="doc-location" title={row.path}>
        {row.location}
      </span>
      {row.branch ? (
        <span className="branch-chip" data-testid="doc-branch" title="git branch">
          ⎇ {row.branch}
        </span>
      ) : null}
      {row.missing ? <span className="missing-badge">missing</span> : null}
    </header>
  );
}

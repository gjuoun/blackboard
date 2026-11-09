"use client";

import Link from "next/link";
import type { WorkspaceCounts } from "@/lib/reading-model";

/** The left rail: the three status views with their counts, how the list works, and the New door. */
export function ReadingRail({ filter, onFilter, counts }: { filter: string; onFilter: (value: "all" | "unread" | "reading") => void; counts: WorkspaceCounts }) {
  const rows = [
    { key: "all" as const, label: "All documents", n: counts.total, dot: <span aria-hidden className="size-[7px] rounded-full bg-current" /> },
    { key: "unread" as const, label: "Unread", n: counts.unread, dot: <span aria-hidden className="bg-primary size-[7px] rounded-full" /> },
    { key: "reading" as const, label: "Reading", n: counts.reading, dot: <span aria-hidden className="ring-muted-foreground size-[7px] rounded-full bg-transparent ring-[1.5px] ring-inset" /> },
  ];
  return (
    <aside data-testid="rw-rail" className="border-border flex h-full min-h-0 flex-col gap-1.5 overflow-auto border-r px-2.5 py-4">
      <h2 className="text-muted-foreground mx-2.5 mt-1 mb-2 text-xs font-semibold">Reading state</h2>
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          data-filter={row.key}
          aria-pressed={filter === row.key}
          onClick={() => onFilter(row.key)}
          className={`flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] ${filter === row.key ? "bg-primary-soft text-primary font-semibold" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
        >
          {row.dot}
          {row.label}
          <span className="ml-auto font-mono text-[11.5px] opacity-80">{row.n}</span>
        </button>
      ))}
      <div className="bg-border mx-2 my-2.5 h-px" />
      <h2 className="text-muted-foreground mx-2.5 mt-1 mb-2 text-xs font-semibold">Order</h2>
      <p className="text-muted-foreground mx-2.5 text-[11.5px] leading-[1.55]">
        One flat list, newest update first, no groups. <b className="text-foreground font-medium">Unread is bold with a solid dot.</b> Opening counts as read; editing the document
        makes it unread again. A document left mid-way keeps its position.
      </p>
      <div className="bg-border mx-2 my-2.5 h-px" />
      <h2 className="text-muted-foreground mx-2.5 mt-1 mb-2 text-xs font-semibold">Where it lives</h2>
      <p className="text-muted-foreground mx-2.5 text-[11.5px] leading-[1.55]">
        Position comes from the preview scroll and is stored in <code className="bg-muted rounded px-1 font-mono">~/.blackboard</code>. Replies go to the document&apos;s comment
        file.
      </p>
      <Link href="/" title="Open a document from Sessions" className="bg-primary text-primary-foreground mt-auto flex h-[38px] items-center justify-center gap-1.5 rounded-full text-[13.5px] font-semibold">
        <span aria-hidden className="text-[17px] leading-none font-normal">＋</span>New
      </Link>
    </aside>
  );
}

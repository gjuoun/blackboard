"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { WorkspaceDoc } from "@/lib/reading-model";

const pctOf = (doc: WorkspaceDoc) => Math.round(doc.progress * 100);

/** The 9px state dot: solid for unread, hollow for reading, invisible when read. */
function StateDot({ status }: { status: WorkspaceDoc["status"] }) {
  return (
    <span
      aria-hidden
      data-testid="rw-dot"
      className={cn(
        "size-[9px] rounded-full",
        status === "unread" && "bg-primary ring-primary-soft ring-[3px]",
        status === "reading" && "ring-primary ring-[1.5px] ring-inset",
      )}
    />
  );
}

/**
 * One email-style row: the state dot, the title line, the mono sub line (path, branch, position)
 * and the meta column the hover actions replace. Selection is a tinted background only.
 */
function Row({ doc, selected, onSelect, onMark }: { doc: WorkspaceDoc; selected: boolean; onSelect: (id: string) => void; onMark: (id: string, action: "read" | "unread") => void }) {
  const unread = doc.status === "unread";
  const act = "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary rounded-[7px] border text-[11.5px] whitespace-nowrap";
  return (
    <article
      data-testid="rw-row"
      data-id={doc.id}
      data-status={doc.status}
      data-selected={selected ? "true" : undefined}
      onClick={() => onSelect(doc.id)}
      className={cn(
        "group relative grid cursor-pointer grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] px-3 py-2.5",
        "[&:not(:first-child)]:shadow-[inset_0_1px_0_var(--border)]",
        "hover:bg-card hover:shadow-none",
        selected && "bg-primary-soft shadow-none",
      )}
    >
      <StateDot status={doc.status} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-[14.5px] leading-[1.35]", unread ? "font-bold" : "font-medium")}>{doc.title}</span>
          {doc.open > 0 ? (
            <span data-testid="rw-open-count" className="bg-primary-soft text-primary shrink-0 rounded-full px-1.5 font-mono text-[10.5px] leading-[17px]">
              {doc.open}
            </span>
          ) : null}
        </div>
        <div className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[11px]">
          <span className="max-w-[52%] truncate" title={doc.path}>
            {doc.location}
          </span>
          {doc.status === "reading" ? (
            <span data-testid="rw-progress" className="flex shrink-0 items-center gap-1.5">
              <span className="bg-muted block h-[3px] w-[54px] overflow-hidden rounded-full">
                <span className="bg-primary block h-full rounded-full" style={{ width: `${pctOf(doc)}%` }} />
              </span>
              <span className="text-primary text-[10.5px]">{pctOf(doc)}%</span>
            </span>
          ) : null}
          {doc.branch ? <span className="truncate opacity-75">⎇ {doc.branch}</span> : null}
        </div>
      </div>
      <div className="text-muted-foreground min-w-[84px] text-right text-[11.5px] leading-[1.4] transition-opacity group-hover:opacity-0 group-data-[selected=true]:opacity-0">
        <b className="text-foreground block text-[11.5px] font-medium">{doc.status === "reading" ? `read ${pctOf(doc)}%` : doc.updated}</b>
        {doc.status === "unread" ? "not opened" : null}
      </div>
      <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100">
        <button
          type="button"
          data-action={unread ? "read" : "unread"}
          onClick={(e) => {
            e.stopPropagation();
            onMark(doc.id, unread ? "read" : "unread");
          }}
          className={cn(act, "h-6 px-2")}
        >
          {unread ? "Mark read" : "Mark unread"}
        </button>
        <Link href={`/s/${doc.id}`} onClick={(e) => e.stopPropagation()} title="Open the document" className={cn(act, "grid size-6 place-items-center")}>
          ↗
        </Link>
      </div>
    </article>
  );
}

/** The middle column: the flat, newest-first list of documents in the current view. */
export function ReadingList({ docs, selected, onSelect, onMark }: { docs: WorkspaceDoc[]; selected: string | null; onSelect: (id: string) => void; onMark: (id: string, action: "read" | "unread") => void }) {
  return (
    <div className="px-[18px] pt-1.5 pb-16" data-testid="rw-list">
      {docs.map((doc) => (
        <Row key={doc.id} doc={doc} selected={doc.id === selected} onSelect={onSelect} onMark={onMark} />
      ))}
      {docs.length === 0 ? <p className="text-muted-foreground px-2.5 pt-6 text-[13px]">No documents in this view.</p> : null}
      <p className="text-muted-foreground mx-2.5 mt-[22px] text-[11.5px] leading-[1.7]">
        One list, newest update first. Unread is bold with a solid dot; opening counts as read, and editing a document makes it unread again. A row left mid-document keeps its
        position. Replies written with <code className="bg-muted rounded px-1 font-mono">blackboard comment</code> do not move it.
      </p>
    </div>
  );
}

import type { DemoDict, DemoRow } from "./data";

interface Props {
  dict: DemoDict;
  readIds: Set<string>;
  tab: "inbox" | "unread";
  onTab: (t: "inbox" | "unread") => void;
  onOpen: (id: string) => void;
}

// Mail-app row: 9px state dot (unread = primary + soft ring), bold title, comment pill,
// mono path+branch subline, updated stamp — mirrors ReadingList.tsx's grid.
function Row({ row, read, onOpen }: { row: DemoRow; read: boolean; onOpen: () => void }) {
  const unread = row.unread && !read;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 text-left shadow-[inset_0_1px_0_var(--border)] first:shadow-none"
    >
      <span
        className={
          unread
            ? "size-[9px] rounded-full bg-primary ring-[3px] ring-primary-soft"
            : "size-[9px] rounded-full"
        }
      />
      <span className="min-w-0">
        <span
          className={`block truncate text-[14.5px] leading-snug ${unread ? "font-bold" : "font-medium"}`}
        >
          {row.title}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
          {row.path} · {row.branch}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        {row.comments > 0 && (
          <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold text-primary">
            {row.comments}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">{row.updated}</span>
      </span>
    </button>
  );
}

const icons = {
  inbox: "M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  unread: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 m0 16v2 M2 12h2 m16 0h2",
};

export function InboxSim({ dict, readIds, tab, onTab, onOpen }: Props) {
  const rows = dict.rows.filter((r) => (tab === "unread" ? r.unread && !readIds.has(r.id) : true));
  const tabs = [
    { id: "inbox" as const, label: dict.tabs.inbox, icon: icons.inbox },
    { id: "unread" as const, label: dict.tabs.unread, icon: icons.unread },
    { id: "settings" as const, label: dict.tabs.settings, icon: icons.settings },
  ];
  return (
    <div className="flex h-[calc(100%-20px)] flex-col">
      <header className="flex items-baseline justify-between px-3 py-2.5">
        <h2 className="text-[15px] font-bold">{dict.inboxTitle}</h2>
        <span className="text-[10px] text-muted-foreground">{rows.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((r) => (
          <Row key={r.id} row={r} read={readIds.has(r.id)} onOpen={() => onOpen(r.id)} />
        ))}
      </div>
      {/* phone tab bar: icon over 9.5px label, active = primary */}
      <nav className="grid h-12 grid-cols-3 border-t border-border bg-background">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => t.id !== "settings" && onTab(t.id)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[9.5px] ${
              tab === t.id ? "font-semibold text-primary" : "text-muted-foreground"
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
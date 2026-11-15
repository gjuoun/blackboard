"use client";

import type { ReadingFilter } from "@/lib/reading-model";

/**
 * The workspace's five views, as the mobile tab bar names them. The first three are the same
 * status filters the rail switches; `new` and `settings` are screens, not filters.
 */
export const WORKSPACE_VIEWS = ["all", "unread", "reading", "new", "settings"] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export const isWorkspaceView = (v: string | null): v is WorkspaceView => WORKSPACE_VIEWS.includes(v as WorkspaceView);

/** Which views filter the list, and to what. */
export const VIEW_FILTERS: Partial<Record<WorkspaceView, ReadingFilter>> = { all: "all", unread: "unread", reading: "reading" };

const ICONS: Record<WorkspaceView, React.ReactNode> = {
  all: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 12h5l2 3h4l2-3h5" />
    </svg>
  ),
  unread: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  ),
  reading: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4h8a5 5 0 0 1 5 5v11H9a4 4 0 0 1-4-4z" />
      <path d="M9 8h5" />
    </svg>
  ),
  new: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M5 8h10M5 16h3" />
      <circle cx="18" cy="8" r="2.2" />
      <circle cx="11" cy="16" r="2.2" />
    </svg>
  ),
};

const LABELS: Record<WorkspaceView, string> = { all: "Inbox", unread: "Unread", reading: "Reading", new: "New", settings: "Settings" };

/**
 * The phone's bottom tab bar: five equal cells, icon over a 9.5px label, active cell in the
 * accent colour. 56px tall over the safe area, and only ever rendered below 768px — the desktop
 * uses the rail and the toolbar instead.
 */
export function WorkspaceTabBar({ view, onView }: { view: WorkspaceView; onView: (v: WorkspaceView) => void }) {
  return (
    <nav
      data-testid="rw-tabbar"
      aria-label="Workspace"
      className="border-border bg-card grid h-[calc(56px+env(safe-area-inset-bottom))] flex-none grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {WORKSPACE_VIEWS.map((key) => (
        <button
          key={key}
          type="button"
          data-testid={`rw-tab-${key}`}
          data-tab={key}
          aria-current={view === key}
          onClick={() => onView(key)}
          className={`flex flex-col items-center justify-center gap-0.5 text-[9.5px] tracking-[0.01em] active:bg-accent ${view === key ? "text-primary font-semibold" : "text-muted-foreground"}`}
        >
          <span className="size-[19px]">{ICONS[key]}</span>
          {LABELS[key]}
        </button>
      ))}
    </nav>
  );
}

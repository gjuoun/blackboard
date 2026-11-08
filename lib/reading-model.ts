/**
 * The reading workspace's plain model: the three states a document can be in, the record kept per
 * document, and the pure reducers and filters the server and the client share. No imports, no IO:
 * the disk format lives in `reading-state.ts`, the server assembly in `reading-workspace.ts`.
 */

export const READING_STATUSES = ["unread", "reading", "read"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

/** The rail's filters. "all" is the unfiltered inbox. */
export const READING_FILTERS = ["all", "unread", "reading"] as const;
export type ReadingFilter = (typeof READING_FILTERS)[number];

/**
 * One document's persisted reading state. `sourceMtime` is the doc file's mtime when this record was
 * written: a different mtime means the document changed, so the record no longer applies.
 */
export type ReadingEntry = {
  status: ReadingStatus;
  /** Scroll position, 0..1. */
  progress: number;
  /** ISO time of the last open, mark or scroll. */
  readAt: string;
  /** The document's mtime in milliseconds, or 0 when the file could not be read. */
  sourceMtime: number;
};

/** A document as the workspace list shows it; every field is real session data. */
export type WorkspaceDoc = {
  id: string;
  title: string;
  path: string;
  /** "repo/rel/path.md" inside git, the absolute path outside it. */
  location: string;
  repo: string | null;
  branch: string | null;
  /** Open comments. */
  open: number;
  /** ISO, for sorting. */
  updatedAt: string;
  /** Already formatted ("2 hours ago"), so server and browser agree. */
  updated: string;
  status: ReadingStatus;
  progress: number;
};

export type WorkspaceCounts = { total: number; unread: number; reading: number; read: number };

/** Everything the workspace page renders on first paint. */
export type WorkspaceData = {
  docs: WorkspaceDoc[];
  counts: WorkspaceCounts;
  /** Open comments across every document: the "awaiting replies" count. */
  pending: number;
  repos: string[];
};

/** One reply shown under the preview: a general comment, or a reply on one. */
export type PreviewReply = { id: string; author: string; body: string; createdAt: string; updated: string };

/** The preview pane's payload: the rendered document plus its general-comment thread. */
export type PreviewData = {
  id: string;
  title: string;
  path: string;
  branch: string | null;
  sections: number;
  diagrams: number;
  updated: string;
  html: string;
  replies: PreviewReply[];
};

export type ReadingAction = "read" | "unread" | "progress" | "read-all";
export type ReadingPatch = { session?: string; action: ReadingAction; progress?: number };
/** What a write answers: the entries that changed, keyed by session id. */
export type ReadingResult = { docs: Record<string, { status: ReadingStatus; progress: number }> };

export const isReadingStatus = (v: unknown): v is ReadingStatus => typeof v === "string" && (READING_STATUSES as readonly string[]).includes(v);

/** A scroll ratio from whatever the browser reported: finite, inside 0..1, three decimals. */
export function clampProgress(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

/** Never opened, or the document changed under the record. */
export function unreadEntry(at: string, sourceMtime = 0): ReadingEntry {
  return { status: "unread", progress: 0, readAt: at, sourceMtime };
}

/** Pointing at a row counts as reading it (the sketch's rule); scrolling refines the position. */
export function markRead(at: string, sourceMtime: number): ReadingEntry {
  return { status: "read", progress: 1, readAt: at, sourceMtime };
}

/** Marking unread clears the position, so an unread row never shows a stale progress bar. */
export function markUnread(at: string, sourceMtime: number): ReadingEntry {
  return { status: "unread", progress: 0, readAt: at, sourceMtime };
}

/** Scrolling: mid-document is `reading`, the bottom is `read`. Progress is the current position. */
export function withProgress(progress: unknown, at: string, sourceMtime: number): ReadingEntry {
  const p = clampProgress(progress);
  const atEnd = p >= 0.98;
  return { status: atEnd ? "read" : "reading", progress: atEnd ? 1 : p, readAt: at, sourceMtime };
}

/**
 * The entry that applies to a document right now. A record written for a different mtime is stale
 * (the document changed), so the document reads as unread with no progress; nothing is written here.
 */
export function effectiveEntry(entry: ReadingEntry | undefined, sourceMtime: number, at = new Date().toISOString()): ReadingEntry {
  if (!entry) return unreadEntry(at, sourceMtime);
  return entry.sourceMtime === sourceMtime ? entry : unreadEntry(at, sourceMtime);
}

export function countStatuses(docs: readonly { status: ReadingStatus }[]): WorkspaceCounts {
  const counts: WorkspaceCounts = { total: docs.length, unread: 0, reading: 0, read: 0 };
  for (const doc of docs) counts[doc.status] += 1;
  return counts;
}

export function filterDocs<T extends { status: ReadingStatus; title: string; location: string; path: string; branch: string | null; repo: string | null }>(
  docs: readonly T[],
  filter: ReadingFilter,
  query = "",
  repo = "",
): T[] {
  const needle = query.trim().toLowerCase();
  return docs.filter((doc) => {
    if (filter === "unread" && doc.status !== "unread") return false;
    if (filter === "reading" && doc.status !== "reading") return false;
    if (repo && doc.repo !== repo) return false;
    if (!needle) return true;
    return [doc.title, doc.location, doc.path, doc.branch ?? "", doc.repo ?? ""].some((v) => v.toLowerCase().includes(needle));
  });
}

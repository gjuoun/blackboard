import { index, sqliteTable } from "drizzle-orm/sqlite-core";

/**
 * The Blackboard data layer: one row per registered doc, its reply-style exchange blocks,
 * comments and review rounds, per-doc reading state, and pi-session bindings. Drizzle reads
 * and writes `~/.blackboard/blackboard.db` (bun:sqlite, WAL); the file is created by
 * `client.ts` alongside the JSON stores it will eventually replace.
 *
 * Timestamps are ISO strings (the format the JSON files already carried). JSON-shaped
 * fields (quote selectors, image id lists, reply threads) stay `text({ mode: "json" })`
 * columns: they are written and read whole, never queried inside.
 */

/** A session: one markdown file registered for review. `path` is nullable — streamed docs
 *  (a later round) keep their markdown in the DB and have no disk path. */
export const documents = sqliteTable("documents", (d) => ({
  id: d.text("id").primaryKey(),
  path: d.text("path"),
  createdAt: d.text("created_at").notNull(),
  openedAt: d.text("opened_at").notNull(),
  kind: d.text("kind"),
  /** Non-null once the session is closed: children are kept on purpose — close never deletes a doc's comments. */
  closedAt: d.text("closed_at"),
  /** The markdown as it was read from disk when indexed. Null until the first index run. */
  body: d.text("body"),
  title: d.text("title"),
  sections: d.integer("sections"),
  diagrams: d.integer("diagrams"),
  branch: d.text("branch"),
  detached: d.integer("detached", { mode: "boolean" }),
  repoName: d.text("repo_name"),
  repoRoot: d.text("repo_root"),
  relPath: d.text("rel_path"),
  worktreeName: d.text("worktree_name"),
  worktreePath: d.text("worktree_path"),
  projectName: d.text("project_name"),
  projectRoot: d.text("project_root"),
  /** The file's mtime (ms) and size when `body` was read: the index is current while both still match. */
  srcMtime: d.integer("src_mtime"),
  srcSize: d.integer("src_size"),
  indexedAt: d.text("indexed_at"),
}));

/** One exchange of the reply-style stream: the unit the streamed doc UI appends. */
export const blocks = sqliteTable(
  "blocks",
  (d) => ({
    id: d.text("id").primaryKey(),
    documentId: d
      .text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Exchange order within the document. */
    n: d.integer("n").notNull(),
    action: d.text("action", { enum: ["answer", "edit", "append"] }).notNull(),
    author: d.text("author").notNull(),
    body: d.text("body").notNull(),
    images: d.text("images", { mode: "json" }).$type<string[]>(),
    /** "writing" while the stream is open, null once the exchange is final. */
    status: d.text("status"),
    at: d.text("at").notNull(),
  }),
  (t) => [index("blocks_document_id").on(t.documentId)],
);

/** A comment on a doc: anchored to a quoted passage, or general. Replies ride along as JSON —
 *  a comment's flat thread is read and written whole. */
export const comments = sqliteTable(
  "comments",
  (d) => ({
    id: d.text("id").primaryKey(),
    documentId: d
      .text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** The docs-map key in the JSON file: the doc file's basename. */
    doc: d.text("doc").notNull(),
    anchor: d.text("anchor_kind", { enum: ["quote", "general"] }).notNull(),
    quote: d.text("quote", { mode: "json" }).$type<{ exact: string; prefix: string; suffix: string }>(),
    body: d.text("body").notNull(),
    images: d.text("images", { mode: "json" }).$type<string[]>(),
    author: d.text("author").notNull(),
    createdAt: d.text("created_at").notNull(),
    editedAt: d.text("edited_at"),
    status: d.text("status", { enum: ["open", "resolved"] }).notNull(),
    resolvedAt: d.text("resolved_at"),
    resolvedBy: d.text("resolved_by"),
    reopenedAt: d.text("reopened_at"),
    reopenedBy: d.text("reopened_by"),
    replies: d
      .text("replies", { mode: "json" })
      .$type<{ id: string; body: string; author: string; createdAt: string; editedAt?: string }[]>()
      .notNull(),
  }),
  (t) => [index("comments_document_id_doc").on(t.documentId, t.doc), index("comments_status").on(t.status)],
);

/** One closed review round for a doc. */
export const reviews = sqliteTable(
  "reviews",
  (d) => ({
    id: d.text("id").primaryKey(),
    documentId: d
      .text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    doc: d.text("doc").notNull(),
    round: d.integer("round").notNull(),
    body: d.text("body").notNull(),
    author: d.text("author").notNull(),
    createdAt: d.text("created_at").notNull(),
    verdict: d.text("verdict", { enum: ["commented"] }).notNull(),
  }),
  (t) => [index("reviews_document_id").on(t.documentId)],
);

/** One doc's reading state, keyed by the document itself. */
export const readingState = sqliteTable("reading_state", (d) => ({
  documentId: d
    .text("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  status: d.text("status", { enum: ["unread", "reading", "read"] }).notNull(),
  /** Scroll position, 0..1. */
  progress: d.real("progress").notNull(),
  readAt: d.text("read_at").notNull(),
  /** The doc file's mtime in ms when this record was written; a different mtime makes it stale. */
  sourceMtime: d.integer("source_mtime").notNull(),
}));

/** A doc bound to the pi session that opened it — the `agents.json` binding record. */
export const agents = sqliteTable("agents", (d) => ({
  /** The Blackboard session id == the document id. */
  session: d
    .text("session")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  path: d.text("path").notNull(),
  piSession: d.text("pi_session").notNull(),
  /** The loopback url the extension listens on. */
  url: d.text("url").notNull(),
  boundAt: d.text("bound_at").notNull(),
  lastSeenAt: d.text("last_seen_at").notNull(),
}));

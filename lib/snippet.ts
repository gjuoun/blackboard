import type { CodeThread } from "./code-anchor";
import { threadKey } from "./code-anchor";
import type { DiffFile, DiffLine, DiffSnapshot } from "./diff-index";
import { normalizeRange, type LineRange } from "./file-refs";

/** Server-rendered line markup for the Local PR tab: snippet first, whole-file diff second. */

type Row = { kind: DiffLine["kind"]; text: string; oldLine: number | null; newLine: number | null };

/** Threads already grouped and resolved by the page, keyed by file and row. */
export type ThreadLookup = ReadonlyMap<string, readonly CodeThread[]>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const span = (cls: string, text: string) => '<span class="' + cls + '">' + (text ? esc(text) : "") + "</span>";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const initial = (author: string) => esc((author.trim()[0] ?? "?").toUpperCase());

const threadsAt = (lookup: ThreadLookup | undefined, path: string, key: string): readonly CodeThread[] =>
  lookup && key ? (lookup.get(threadKey(path, key)) ?? []) : [];

/**
 * One comment and its replies as a full-width row of the diff box, GitHub-style: a 3px primary left
 * edge while unresolved (warn while orphaned), one line per entry, a Reply…/Resolve foot. Bodies
 * arrive already rendered and escaped by the comment pipeline; every other value is escaped here.
 */
function threadHtml(t: CodeThread, key: string): string {
  const resolved = t.status === "resolved";
  const badge = t.orphaned
    ? '<span class="cc-orphan" data-testid="code-orphan">' + esc(key) + (t.movedTo ? " \u21a6 \u73b0 L" + t.movedTo : "") + "</span>"
    : "";
  const entries = t.entries
    .map((e, i) => {
      const meta =
        '<b>' + esc(e.author) + "</b> " + (e.reply ? "replied" : "commented") + " \u00b7 <time>" + esc(when(e.createdAt)) + "</time>" + (i === 0 ? badge : "");
      return (
        '<div class="cc-item" data-testid="code-item" data-id="' + esc(e.id) + '">' +
        '<span class="cc-ava ' + (e.author === "jun" ? "jun" : "agent") + '">' + initial(e.author) + "</span>" +
        "<div><p class=\"cc-meta\">" + meta + '</p><div class="cc-body">' + e.html + "</div></div></div>"
      );
    })
    .join("");
  const foot =
    '<div class="cc-foot">' +
    '<button type="button" class="cc-reply" data-testid="code-reply" data-id="' + esc(t.id) + '">Reply\u2026</button>' +
    '<button type="button" class="cc-resolve" data-testid="code-resolve" data-id="' + esc(t.id) + '" data-resolved="' + resolved + '">' +
    (resolved ? "Reopen conversation" : "Resolve conversation") +
    "</button></div>";
  const cls = "cc-thread" + (resolved ? " resolved" : "") + (t.orphaned ? " orphan" : "");
  return '<div class="' + cls + '" data-testid="code-thread" data-anchor="' + esc(key) + '" data-id="' + esc(t.id) + '">' + entries + foot + "</div>";
}

/** A diff line row, its count badge and hover entry, and any thread that hangs from it. */
function rowHtml(row: Row, inRange: boolean, path: string, threads?: ThreadLookup): string {
  const key = row.kind === "del" ? "Lold" + row.oldLine : row.newLine !== null ? "L" + row.newLine : "";
  const list = threadsAt(threads, path, key);
  const cls = "dl " + (row.kind === "ctx" ? "ctx" : row.kind) + (inRange ? " inr" : "") + (list.length ? " cmt" : "");
  const id = row.kind === "del" ? "Lold" + row.oldLine : row.newLine !== null ? "L" + row.newLine : "";
  const lo = row.oldLine === null ? "" : String(row.oldLine);
  const ln = row.newLine === null ? "" : String(row.newLine);
  const sign = row.kind === "add" ? "+" : row.kind === "del" ? "\u2212" : "";
  const attrs = id ? ' id="' + id + '"' : "";
  const count = list.reduce((n, t) => n + t.count, 0);
  const badge = count > 0 ? '<span class="cmt-n" data-testid="code-count">' + count + "</span>" : "";
  const add = key
    ? '<button type="button" class="cc-add" data-testid="code-add" data-anchor="' + key + '" aria-label="Comment on ' + key + '" title="Comment on ' + key + '">+</button>'
    : "";
  return (
    '<div class="' + cls + '"' + attrs + ">" +
    span("lo", lo) +
    span("ln", ln) +
    span("sg", sign) +
    span("tx", row.text) +
    badge +
    add +
    "</div>" +
    list.map((t) => threadHtml(t, key)).join("")
  );
}

const hunkRow = (text: string) =>
  '<div class="dl hunk">' + span("lo", "") + span("ln", "") + span("sg", "") + span("tx", text) + "</div>";

const foldRow = (start: number, end: number) =>
  '<div class="dl fold">' + span("lo", "") + span("ln", "") + span("sg", "") + span("tx", "\u22ef L" + start + "-L" + end + " unchanged, folded \u22ef") + "</div>";

/** Keep two context lines at each edge of a long unchanged span. */
const FOLD_AFTER = 8;
const FOLD_KEEP = 2;

function fold(rows: Row[], path: string, threads?: ThreadLookup): string {
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== "ctx") {
      out.push(rowHtml(rows[i], true, path, threads));
      i += 1;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === "ctx") j += 1;
    const run = rows.slice(i, j);
    if (run.length <= FOLD_AFTER) {
      for (const row of run) out.push(rowHtml(row, true, path, threads));
    } else {
      for (const row of run.slice(0, FOLD_KEEP)) out.push(rowHtml(row, true, path, threads));
      const first = run[FOLD_KEEP].newLine;
      const last = run[run.length - FOLD_KEEP - 1].newLine;
      out.push(foldRow(first ?? 0, last ?? 0));
      for (const row of run.slice(-FOLD_KEEP)) out.push(rowHtml(row, true, path, threads));
    }
    i = j;
  }
  return out.join("");
}

/** New-line -> added line and the deletions that sit just before a new line number. */
function maps(file: DiffFile): { adds: Map<number, DiffLine>; dels: Map<number, DiffLine[]>; ctx: Map<number, number> } {
  const adds = new Map<number, DiffLine>();
  const dels = new Map<number, DiffLine[]>();
  const ctx = new Map<number, number>();
  for (const hunk of file.hunks) {
    let newNo = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        adds.set(newNo, line);
        newNo += 1;
      } else if (line.kind === "del") {
        const at = dels.get(newNo);
        if (at) at.push(line);
        else dels.set(newNo, [line]);
      } else {
        if (line.oldLine !== null) ctx.set(newNo, line.oldLine);
        newNo += 1;
      }
    }
  }
  return { adds, dels, ctx };
}

export type Snippet = {
  path: string;
  range: LineRange;
  additions: number;
  deletions: number;
  html: string;
  /** "ok" | "unchanged" | "deleted" | "binary" — a stable state instead of an exception. */
  state: "ok" | "unchanged" | "deleted" | "binary";
};

const missingHtml = (text: string) => '<p class="diff-empty" data-testid="diff-empty">' + esc(text) + "</p>";

/** Rows for a range of the worktree file, with hunks supplying add/delete classification. */
function rangeRows(file: DiffFile, content: readonly string[] | null, range: LineRange): Row[] {
  if (content === null) {
    // No worktree text (deleted or binary): show the patch lines that fall inside the range.
    const rows: Row[] = [];
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const no = line.newLine ?? line.oldLine;
        if (no !== null && no >= range.start && no <= range.end) rows.push({ kind: line.kind, text: line.text, oldLine: line.oldLine, newLine: line.newLine });
      }
    }
    return rows;
  }
  const { adds, dels, ctx } = maps(file);
  const rows: Row[] = [];
  const pushDels = (at: number) => {
    for (const line of dels.get(at) ?? []) rows.push({ kind: "del", text: line.text, oldLine: line.oldLine, newLine: null });
  };
  for (let n = range.start; n <= range.end; n += 1) {
    pushDels(n);
    const add = adds.get(n);
    if (add) rows.push({ kind: "add", text: add.text, oldLine: null, newLine: n });
    else if (n - 1 < content.length) rows.push({ kind: "ctx", text: content[n - 1], oldLine: ctx.get(n) ?? null, newLine: n });
  }
  pushDels(range.end + 1);
  return rows;
}

/** A selected range, clamped to the file and with its in-range add/delete counts. */
export function renderSnippet(snapshot: DiffSnapshot, path: string, request: { start: number; end: number }, threads?: ThreadLookup): Snippet {
  const file = snapshot.file(path);
  const wanted = normalizeRange(request.start, request.end) ?? { start: 1, end: 1 };
  if (!file) {
    return { path, range: wanted, additions: 0, deletions: 0, html: missingHtml("No local change for this file."), state: "unchanged" };
  }
  if (file.binary) {
    return { path, range: wanted, additions: file.additions, deletions: file.deletions, html: missingHtml("Binary file — no line diff."), state: "binary" };
  }
  const content = snapshot.content(path);
  let range = wanted;
  if (content && content.length > 0) {
    const start = Math.min(Math.max(1, wanted.start), content.length);
    const end = Math.min(Math.max(start, wanted.end), content.length);
    range = { start, end };
  }
  const box = (html: string) => '<div class="dv" data-testid="snippet-lines" data-path="' + esc(path) + '">' + html + "</div>";
  if (file.status === "deleted" && content === null) {
    const rows = rangeRows(file, null, range);
    return {
      path,
      range,
      additions: rows.filter((r) => r.kind === "add").length,
      deletions: rows.filter((r) => r.kind === "del").length,
      html: box(rows.map((r) => rowHtml(r, true, path, threads)).join("")),
      state: "deleted",
    };
  }
  if (content === null) {
    return { path, range, additions: file.additions, deletions: file.deletions, html: missingHtml("This file is too large to preview."), state: "binary" };
  }
  const rows = rangeRows(file, content, range);
  return {
    path,
    range,
    additions: rows.filter((r) => r.kind === "add").length,
    deletions: rows.filter((r) => r.kind === "del").length,
    html: box(fold(rows, path, threads)),
    state: "ok",
  };
}

export type WholeDiff = { path: string; additions: number; deletions: number; html: string; state: "ok" | "unchanged" | "binary" };

/** The whole file diff: every hunk, with the same row vocabulary as a snippet. */
export function renderFileDiff(snapshot: DiffSnapshot, path: string, threads?: ThreadLookup): WholeDiff {
  const file = snapshot.file(path);
  if (!file) return { path, additions: 0, deletions: 0, html: missingHtml("No local change for this file."), state: "unchanged" };
  if (file.binary) return { path, additions: file.additions, deletions: file.deletions, html: missingHtml("Binary file — no line diff."), state: "binary" };
  const body: string[] = [];
  for (const hunk of file.hunks) {
    body.push(hunkRow("@@" + " -" + hunk.oldStart + "," + hunk.oldLines + " +" + hunk.newStart + "," + hunk.newLines + " @@" + (hunk.header ? " " + hunk.header : "")));
    for (const line of hunk.lines) body.push(rowHtml({ kind: line.kind, text: line.text, oldLine: line.oldLine, newLine: line.newLine }, false, path, threads));
  }
  const html = '<div class="dv" data-testid="file-diff" data-path="' + esc(path) + '">' + body.join("") + "</div>";
  return { path, additions: file.additions, deletions: file.deletions, html, state: "ok" };
}

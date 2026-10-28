import type { DiffFile, DiffLine, DiffSnapshot } from "./diff-index";
import { normalizeRange, type LineRange } from "./file-refs";

/** Server-rendered line markup for the Local PR tab: snippet first, whole-file diff second. */

type Row = { kind: DiffLine["kind"]; text: string; oldLine: number | null; newLine: number | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const span = (cls: string, text: string) => '<span class="' + cls + '">' + (text ? esc(text) : "") + "</span>";

function rowHtml(row: Row, inRange: boolean): string {
  const cls = "dl " + (row.kind === "ctx" ? "ctx" : row.kind) + (inRange ? " inr" : "");
  const id = row.kind === "del" ? "Lold" + row.oldLine : row.newLine !== null ? "L" + row.newLine : "";
  const lo = row.oldLine === null ? "" : String(row.oldLine);
  const ln = row.newLine === null ? "" : String(row.newLine);
  const sign = row.kind === "add" ? "+" : row.kind === "del" ? "\u2212" : "";
  const attrs = id ? ' id="' + id + '"' : "";
  return (
    '<div class="' + cls + '"' + attrs + ">" +
    span("lo", lo) +
    span("ln", ln) +
    span("sg", sign) +
    span("tx", row.text) +
    "</div>"
  );
}

const hunkRow = (text: string) =>
  '<div class="dl hunk">' + span("lo", "") + span("ln", "") + span("sg", "") + span("tx", text) + "</div>";

const foldRow = (start: number, end: number) =>
  '<div class="dl fold">' + span("lo", "") + span("ln", "") + span("sg", "") + span("tx", "\u22ef L" + start + "-L" + end + " unchanged, folded \u22ef") + "</div>";

/** Keep two context lines at each edge of a long unchanged span. */
const FOLD_AFTER = 8;
const FOLD_KEEP = 2;

function fold(rows: Row[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== "ctx") {
      out.push(rowHtml(rows[i], true));
      i += 1;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === "ctx") j += 1;
    const run = rows.slice(i, j);
    if (run.length <= FOLD_AFTER) {
      for (const row of run) out.push(rowHtml(row, true));
    } else {
      for (const row of run.slice(0, FOLD_KEEP)) out.push(rowHtml(row, true));
      const first = run[FOLD_KEEP].newLine;
      const last = run[run.length - FOLD_KEEP - 1].newLine;
      out.push(foldRow(first ?? 0, last ?? 0));
      for (const row of run.slice(-FOLD_KEEP)) out.push(rowHtml(row, true));
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
export function renderSnippet(snapshot: DiffSnapshot, path: string, request: { start: number; end: number }): Snippet {
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
  if (file.status === "deleted" && content === null) {
    const rows = rangeRows(file, null, range);
    return {
      path,
      range,
      additions: rows.filter((r) => r.kind === "add").length,
      deletions: rows.filter((r) => r.kind === "del").length,
      html: '<div class="dv" data-testid="snippet-lines">' + rows.map((r) => rowHtml(r, true)).join("") + "</div>",
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
    html: '<div class="dv" data-testid="snippet-lines">' + fold(rows) + "</div>",
    state: "ok",
  };
}

export type WholeDiff = { path: string; additions: number; deletions: number; html: string; state: "ok" | "unchanged" | "binary" };

/** The whole file diff: every hunk, with the same row vocabulary as a snippet. */
export function renderFileDiff(snapshot: DiffSnapshot, path: string): WholeDiff {
  const file = snapshot.file(path);
  if (!file) return { path, additions: 0, deletions: 0, html: missingHtml("No local change for this file."), state: "unchanged" };
  if (file.binary) return { path, additions: file.additions, deletions: file.deletions, html: missingHtml("Binary file — no line diff."), state: "binary" };
  const body: string[] = [];
  for (const hunk of file.hunks) {
    body.push(hunkRow("@@ -" + hunk.oldStart + "," + hunk.oldLines + " +" + hunk.newStart + "," + hunk.newLines + " @@" + (hunk.header ? " " + hunk.header : "")));
    for (const line of hunk.lines) body.push(rowHtml({ kind: line.kind, text: line.text, oldLine: line.oldLine, newLine: line.newLine }, false));
  }
  const html = '<div class="dv" data-testid="file-diff">' + body.join("") + "</div>";
  return { path, additions: file.additions, deletions: file.deletions, html, state: "ok" };
}

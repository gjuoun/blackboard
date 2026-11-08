import { describe, expect, test } from "bun:test";
import {
  clampProgress,
  countStatuses,
  effectiveEntry,
  filterDocs,
  markRead,
  markUnread,
  unreadEntry,
  withProgress,
  type ReadingEntry,
  type WorkspaceDoc,
} from "./reading-model";

const at = "2026-11-08T10:00:00.000Z";
const entry = (status: ReadingEntry["status"], progress: number, sourceMtime = 100): ReadingEntry => ({ status, progress, readAt: at, sourceMtime });

const doc = (id: string, status: ReadingEntry["status"], over: Partial<WorkspaceDoc> = {}): WorkspaceDoc => ({
  id,
  title: `Doc ${id}`,
  path: `/repo/docs/${id}.md`,
  location: `repo/docs/${id}.md`,
  repo: "repo",
  branch: "main",
  open: 0,
  updatedAt: at,
  updated: "just now",
  status,
  progress: 0,
  ...over,
});

describe("progress", () => {
  test("clamps to 0..1 with three decimals", () => {
    expect(clampProgress(0.4267)).toBe(0.427);
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress("0.5")).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  test("mid-document is reading, the bottom is read", () => {
    expect(withProgress(0.15, at, 1)).toEqual({ status: "reading", progress: 0.15, readAt: at, sourceMtime: 1 });
    expect(withProgress(0.5, at, 1).status).toBe("reading");
    expect(withProgress(0.9, at, 1).status).toBe("reading");
    expect(withProgress(0.98, at, 1)).toEqual({ status: "read", progress: 1, readAt: at, sourceMtime: 1 });
    expect(withProgress(1, at, 1).status).toBe("read");
  });

  test("mark read keeps a full bar, mark unread clears it", () => {
    expect(markRead(at, 7)).toEqual({ status: "read", progress: 1, readAt: at, sourceMtime: 7 });
    expect(markUnread(at, 7)).toEqual({ status: "unread", progress: 0, readAt: at, sourceMtime: 7 });
  });
});

describe("effective entry", () => {
  test("nothing stored reads as unread", () => {
    expect(effectiveEntry(undefined, 42, at)).toEqual(unreadEntry(at, 42));
  });

  test("a record written for the same mtime still applies", () => {
    expect(effectiveEntry(entry("reading", 0.4, 42), 42, at)).toMatchObject({ status: "reading", progress: 0.4 });
  });

  test("an edited document goes back to unread with no progress", () => {
    expect(effectiveEntry(entry("reading", 0.4, 41), 42, at)).toMatchObject({ status: "unread", progress: 0, sourceMtime: 42 });
    expect(effectiveEntry(entry("read", 1, 41), 42, at).status).toBe("unread");
  });
});

describe("counts and filters", () => {
  const docs = [doc("a", "unread"), doc("b", "reading", { progress: 0.4 }), doc("c", "read"), doc("d", "unread", { repo: null, branch: null, location: "/notes/d.md" })];

  test("counts every state and the total", () => {
    expect(countStatuses(docs)).toEqual({ total: 4, unread: 2, reading: 1, read: 1 });
    expect(countStatuses([])).toEqual({ total: 0, unread: 0, reading: 0, read: 0 });
  });

  test("the status filter is exclusive; all keeps every state", () => {
    expect(filterDocs(docs, "all").map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterDocs(docs, "unread").map((d) => d.id)).toEqual(["a", "d"]);
    expect(filterDocs(docs, "reading").map((d) => d.id)).toEqual(["b"]);
  });

  test("query and repo narrow the view together", () => {
    expect(filterDocs(docs, "all", "doc c").map((d) => d.id)).toEqual(["c"]);
    expect(filterDocs(docs, "all", "", "repo").map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(filterDocs(docs, "all", "notes", "repo").map((d) => d.id)).toEqual([]);
    expect(filterDocs(docs, "all", "MAIN").map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
});

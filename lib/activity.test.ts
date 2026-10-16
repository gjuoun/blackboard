import { describe, expect, test } from "bun:test";
import { activitySince } from "./activity";
import type { CommentFile } from "./comments-store";

const q = { exact: "The cache is warm.", prefix: "", suffix: "" };
const T0 = "2026-10-16T10:00:00.000Z";
const file: CommentFile = {
  version: 1,
  docs: {
    "design.md": [
      { id: "c1", quote: q, body: "old note", author: "jun", createdAt: "2026-10-16T09:00:00.000Z", status: "open",
        reopenedAt: "2026-10-16T10:05:00.000Z", reopenedBy: "jun",
        replies: [
          { id: "r1", body: "my answer", author: "agent", createdAt: "2026-10-16T10:01:00.000Z" },
          { id: "r2", body: "not quite", author: "jun", createdAt: "2026-10-16T10:02:00.000Z" },
        ] },
      { id: "c2", quote: q, body: "agent question", author: "agent", createdAt: "2026-10-16T10:03:00.000Z", status: "open", replies: [] },
    ],
    "brief.md": [
      { id: "c3", quote: q, body: "new from jun", author: "jun", createdAt: "2026-10-16T10:04:00.000Z", editedAt: "2026-10-16T10:06:00.000Z", status: "open", replies: [] },
      { id: "c4", quote: q, body: "done", author: "agent", createdAt: "2026-10-16T09:30:00.000Z", status: "resolved", resolvedAt: "2026-10-16T10:07:00.000Z", resolvedBy: "jun", replies: [] },
    ],
  },
};

describe("activitySince", () => {
  const { events, next } = activitySince(file, T0, "agent");
  const summary = events.map((e) => `${e.at.slice(11, 16)} ${e.kind} ${e.doc} ${e.commentId} ${e.author}`);

  test("lists everything others did since, oldest first", () => {
    expect(summary).toEqual([
      "10:02 reply design.md c1 jun",
      "10:04 comment brief.md c3 jun",
      "10:05 reopen design.md c1 jun",
      "10:06 edit brief.md c3 jun",
      "10:07 resolve brief.md c4 jun",
    ]);
  });

  test("ignores my own replies and comments", () => {
    expect(summary.some((s) => s.endsWith(" agent"))).toBe(false);
  });

  test("reports a reopen with the comment it reopened", () => {
    const e = events.find((x) => x.kind === "reopen")!;
    expect(e).toMatchObject({ commentId: "c1", body: "old note", quote: "The cache is warm." });
  });

  test("next is the newest event time, so the next wait starts after it", () => {
    expect(next).toBe("2026-10-16T10:07:00.000Z");
    expect(activitySince(file, next, "agent")).toEqual({ events: [], next });
  });
});

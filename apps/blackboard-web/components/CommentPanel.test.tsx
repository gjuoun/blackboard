import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Review } from "@/lib/comments-store";
import { CommentPanel, type PanelComment } from "./CommentPanel";

const review: Review = { id: "v1", doc: "design.md", round: 1, body: "all answered", author: "agent", createdAt: "2026-11-02T10:00:00.000Z", verdict: "commented" };

const comment = (id: string, over: Partial<PanelComment> = {}): PanelComment => ({
  id,
  quote: { exact: "cache", prefix: "", suffix: "" },
  body: "note",
  author: "jun",
  createdAt: "2026-11-02T09:00:00.000Z",
  status: "open",
  replies: [],
  html: "<p>note</p>",
  orphaned: false,
  ...over,
});

const props = (comments: PanelComment[], reviews: Review[]) => ({
  title: "Design",
  path: "docs/design.md",
  comments,
  reviews,
  activeId: null,
  flashId: null,
  onActivate: () => {},
  onReply: async () => {},
  onResolve: async () => {},
  onEdit: async () => {},
  onDelete: async () => {},
  onEditReply: async () => {},
  onDeleteReply: async () => {},
  showResolved: false,
  onShowResolved: () => {},
  author: "jun",
  onAuthor: () => {},
  composer: null,
  error: null,
});

describe("comment panel review cards", () => {
  test("review: review card shows with no comments", () => {
    // A round can close on a doc that has no open comments; the card must not depend on a comment row.
    const html = renderToStaticMarkup(<CommentPanel {...props([], [review])} />);
    expect(html).toContain('data-testid="review-card"');
    expect(html).toContain('data-verdict="commented"');
    expect(html).not.toContain('data-testid="comment-item"');
  });

  test("review: order is anchored, then reviews, then general", () => {
    const html = renderToStaticMarkup(
      <CommentPanel {...props([comment("a"), comment("g", { quote: undefined, general: true })], [review])} />,
    );
    const anchored = html.indexOf('data-id="a"');
    const card = html.indexOf('data-testid="review-card"');
    const divider = html.indexOf('data-testid="general-divider"');
    const general = html.indexOf('data-id="g"');
    expect(anchored).toBeGreaterThan(-1);
    expect(anchored < card && card < divider && divider < general).toBe(true);
  });
});

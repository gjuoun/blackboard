import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentPanel, type PanelComment } from "./CommentPanel";

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

const props = (comments: PanelComment[]) => ({
  title: "Design",
  path: "docs/design.md",
  comments,
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

describe("comment panel ordering", () => {
  test("order is anchored, then general", () => {
    const html = renderToStaticMarkup(
      <CommentPanel {...props([comment("a"), comment("g", { quote: undefined, general: true })])} />,
    );
    const anchored = html.indexOf('data-id="a"');
    const divider = html.indexOf('data-testid="general-divider"');
    const general = html.indexOf('data-id="g"');
    expect(anchored).toBeGreaterThan(-1);
    expect(anchored < divider && divider < general).toBe(true);
  });
});

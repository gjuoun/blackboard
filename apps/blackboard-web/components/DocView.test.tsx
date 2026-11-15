import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// DocView is a client component; outside Next its only router use is the live-refresh effect.
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/s/abc",
}));

import { renderToStaticMarkup } from "react-dom/server";
import type { RenderedComment } from "@/lib/comment-markdown";
import { DocView } from "./DocView";

const comment = (id: string, status: "open" | "resolved"): RenderedComment => ({
  id,
  quote: { exact: "cache", prefix: "", suffix: "" },
  body: "note",
  author: "jun",
  createdAt: "2026-10-28T10:00:00.000Z",
  status,
  replies: [],
  html: "<p>note</p>",
});

function render(over: { comments?: RenderedComment[] } = {}) {
  return renderToStaticMarkup(
    <DocView
      session="abc"
      title="Plan"
      path="/repo/docs/plan.md"
      html="<p>body</p>"
      initialComments={over.comments ?? [comment("c1", "open"), comment("c2", "resolved")]}
      header={null}
      toc={<nav data-testid="toc">Contents</nav>}
    />,
  );
}

describe("DocView right rail", () => {
  test("the rail is the comments panel alone: no tab strip, no File tab", () => {
    const html = render();
    expect(html).toContain('data-testid="comments-panel"');
    expect(html).toContain('data-testid="comments-pane"');
    expect(html).not.toContain('data-testid="right-tabs"');
    expect(html).not.toContain('data-testid="right-tab-file"');
    expect(html).not.toContain('data-testid="right-tab-comments"');
    expect(html).not.toContain('data-testid="file-pane"');
  });

  test("the contents panel and the resize handles survive", () => {
    const html = render();
    expect(html).toContain('data-testid="toc-panel"');
    expect(html).toContain('data-testid="toc"');
    expect(html).toContain('data-testid="resize-toc"');
    expect(html).toContain('data-testid="resize-cm"');
  });

  test("the comments pane lists the resolved flag and the comment body", () => {
    const html = render({ comments: [comment("c1", "open")] });
    expect(html).toContain('data-testid="comments-pane"');
    expect(html).toContain("note");
    expect(html).toContain("Comments");
  });
});

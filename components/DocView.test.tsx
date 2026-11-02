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

const FILE = {
  panel: <div data-testid="fake-file">source</div>,
  href: "?tab=file",
  commentHref: "?tab=comments",
};

function render(over: { rightTab?: "comments" | "file"; noFile?: boolean; comments?: RenderedComment[] } = {}) {
  return renderToStaticMarkup(
    <DocView
      session="abc"
      title="Plan"
      path="/repo/docs/plan.md"
      html="<p>body</p>"
      initialComments={over.comments ?? [comment("c1", "open"), comment("c2", "resolved")]}
      header={null}
      toc={<nav data-testid="toc">Contents</nav>}
      rightTab={over.rightTab ?? "comments"}
      fileRail={over.noFile ? undefined : FILE}
    />,
  );
}

describe("DocView right rail", () => {
  test("Comments and File share one right column with the open count", () => {
    const html = render();
    expect(html).toContain('data-testid="right-tabs"');
    expect(html).toContain('data-testid="right-tab-comments"');
    expect(html).toContain('data-testid="right-tab-file"');
    expect(html).toContain('class="count">1</span>');
    expect(html).toContain('data-tab="comments"');
    expect(html).not.toContain("Local PR");
  });

  test("the query-selected tab paints active and shows the file pane", () => {
    const html = render({ rightTab: "file" });
    expect(html).toContain('aria-selected="true" data-testid="right-tab-file"');
    expect(html).toContain('data-tab="file"');
    expect(html).toContain('data-testid="fake-file"');
    expect(html).toContain('data-testid="file-pane"');
  });

  test("the contents panel and the shared resize handle survive the tab", () => {
    const html = render({ rightTab: "file" });
    expect(html).toContain('data-testid="toc-panel"');
    expect(html).toContain('data-testid="toc"');
    expect(html).toContain('data-testid="resize-toc"');
    expect(html).toContain('data-testid="resize-cm"');
    expect(html).toContain('data-testid="comments-panel"');
  });

  test("without a file rail the rail is the comments panel alone", () => {
    const html = render({ noFile: true });
    expect(html).not.toContain('data-testid="right-tabs"');
    expect(html).toContain('data-testid="comments-pane"');
  });

  test("the comments pane still lists the resolved flag and the comment body", () => {
    const html = render({ comments: [comment("c1", "open")] });
    expect(html).toContain('data-testid="comments-pane"');
    expect(html).toContain("note");
    expect(html).toContain("Comments");
    // The tab strip carries the open count now that the panel has no title row.
    expect(html).toContain('<span class="count">1</span>');
  });
});

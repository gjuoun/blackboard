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

const DIFF = {
  panel: <div data-testid="fake-pr">server diff</div>,
  commentHref: "?tab=comments",
  prHref: "?tab=pr&file=docs%2Fplan.md&L=L2-L5",
  additions: 3,
  deletions: 1,
};

function render(over: { rightTab?: "comments" | "pr"; noDiff?: boolean; comments?: RenderedComment[]; codeState?: Record<string, { orphaned: boolean; movedTo: number | null }> } = {}) {
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
      diff={over.noDiff ? undefined : DIFF}
      codeState={over.codeState}
    />,
  );
}

describe("DocView right rail", () => {
  test("Comments and Local PR share one right column with counts", () => {
    const html = render();
    expect(html).toContain('data-testid="right-tabs"');
    expect(html).toContain('data-testid="right-tab-comments"');
    expect(html).toContain('data-testid="right-tab-pr"');
    expect(html).toContain('class="count">1</span>');
    expect(html).toContain("+3");
    expect(html).toContain('data-tab="comments"');
  });

  test("the query-selected tab paints active and shows the server diff pane", () => {
    const html = render({ rightTab: "pr" });
    expect(html).toContain('aria-selected="true" data-testid="right-tab-pr"');
    expect(html).toContain('data-tab="pr"');
    expect(html).toContain('data-testid="fake-pr"');
    expect(html).toContain('data-testid="diff-pane"');
  });

  test("the contents panel and the shared resize handle survive the tab", () => {
    const html = render({ rightTab: "pr" });
    expect(html).toContain('data-testid="toc-panel"');
    expect(html).toContain('data-testid="toc"');
    expect(html).toContain('data-testid="resize-toc"');
    expect(html).toContain('data-testid="resize-cm"');
    expect(html).toContain('data-testid="comments-panel"');
  });

  test("without a snapshot the rail stays a comments-only panel", () => {
    const html = render({ noDiff: true });
    expect(html).not.toContain('data-testid="right-tab-pr"');
    expect(html).toContain('data-testid="comments-pane"');
  });

  test("a code-anchored comment lists as a path:line chip that links back to the diff", () => {
    const codeComment: RenderedComment = {
      ...comment("c9", "open"),
      quote: undefined,
      code: { path: "lib/residency.ts", startLine: 12, endLine: 12, side: "new", lineText: "  return gate;" },
    };
    const html = render({ comments: [codeComment], codeState: { c9: { orphaned: false, movedTo: null } } });
    expect(html).toContain('data-testid="code-chip"');
    expect(html).toContain("lib/residency.ts:L12");
    expect(html).toContain('href="?tab=pr&amp;file=lib%2Fresidency.ts&amp;L=L12"');
    expect(html).not.toContain("Passage no longer in the doc");
    expect(html).not.toContain('data-orphaned="true"');
  });

  test("a drifted code anchor names the line it reads on today", () => {
    const codeComment: RenderedComment = {
      ...comment("c9", "open"),
      quote: undefined,
      code: { path: "lib/residency.ts", startLine: 12, endLine: 12, side: "new", lineText: "  return gate;" },
    };
    const html = render({ comments: [codeComment], codeState: { c9: { orphaned: true, movedTo: 14 } } });
    expect(html).toContain('data-testid="code-chip-orphan"');
    expect(html).toContain("L12 ↦ 现 L14");
  });

  test("the comments pane still lists the resolved flag and the comment body", () => {
    const html = render({ comments: [comment("c1", "open")] });
    expect(html).toContain('data-testid="comments-pane"');
    expect(html).toContain("note");
    expect(html).toContain("Comments");
    expect(html).toContain('title="1 open"');
  });
});

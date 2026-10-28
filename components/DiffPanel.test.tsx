import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffFileList } from "@/components/DiffFileList";
import { DiffPanel } from "@/components/DiffPanel";
import { RightTabs } from "@/components/RightTabs";
import { planFile, snapshot } from "@/lib/test-diff";

describe("RightTabs", () => {
  test("is a server-rendered tablist with both counts", () => {
    const html = renderToStaticMarkup(<RightTabs active="pr" commentHref="?tab=comments" prHref="?tab=pr&file=docs%2Fplan.md" open={4} additions={3} deletions={1} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-testid="right-tab-comments"');
    expect(html).toContain("Comments <span class=\"count\">4</span>");
    expect(html).toContain('href="?tab=pr&amp;file=docs%2Fplan.md"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("+3");
  });

  test("the comments tab is selected by default and PR can be hidden", () => {
    const html = renderToStaticMarkup(<RightTabs active="comments" commentHref="?tab=comments" prHref="?tab=pr" open={0} additions={0} deletions={0} showPr={false} />);
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('data-testid="right-tab-pr"');
  });
});

describe("DiffFileList", () => {
  test("each row links to its file and keeps the directory and file name separable", () => {
    const html = renderToStaticMarkup(<DiffFileList index={snapshot([planFile()])} selected="docs/plan.md" />);
    expect(html).toContain('data-status="modified"');
    expect(html).toContain('class="st M"');
    expect(html).toContain('title="docs/plan.md"');
    expect(html).toContain('<bdi class="pr-dir">docs/</bdi><bdi class="pr-name">plan.md</bdi>');
    expect(html).toContain('href="?tab=pr&amp;file=docs%2Fplan.md"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('class="stat"');
  });

  test("status badges cover added, deleted and renamed files", () => {
    const html = renderToStaticMarkup(
      <DiffFileList
        index={snapshot([
          planFile({ path: "a.md", status: "added", additions: 2, deletions: 0 }),
          planFile({ path: "b.md", status: "deleted", additions: 0, deletions: 2 }),
          planFile({ path: "c.md", status: "renamed", oldPath: "old.md", additions: 1, deletions: 1 }),
        ])}
        selected={null}
      />,
    );
    expect(html).toContain(">A<");
    expect(html).toContain(">D<");
    expect(html).toContain(">R<");
  });

  test("an empty diff is a stable message", () => {
    const html = renderToStaticMarkup(<DiffFileList index={snapshot([])} selected={null} />);
    expect(html).toContain("No local changes against main.");
  });
});

describe("DiffPanel", () => {
  test("the sorted file list carries the base chip and totals", () => {
    const html = renderToStaticMarkup(<DiffPanel index={snapshot()} selected={null} />);
    expect(html).toContain("Local PR");
    expect(html).toContain("base main @ abc1234");
    expect(html).toContain("1 files");
    expect(html).toContain("tracked + staged + untracked");
  });

  test("a missing path is a state, not a throw", () => {
    const html = renderToStaticMarkup(<DiffPanel index={snapshot()} selected={{ path: "nope.md", start: 1, end: 3 }} />);
    expect(html).toContain("No local change for this file.");
  });
});

import { describe, expect, mock, test } from "bun:test";

// The pane wraps its snippet in the code-comment island, whose only router use is refresh().
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

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
describe("DiffPanel document references", () => {
  const index = () => snapshot([planFile({ path: "docs/plan.md", additions: 3, deletions: 1 }), planFile({ path: "lib/a.ts", additions: 2, deletions: 4 }), planFile({ path: "lib/b.ts", additions: 1, deletions: 0 })]);
  const rows = (html: string) => [...html.matchAll(/data-file="([^"]+)"/g)].map((m) => m[1]);
  const summary = (html: string) => /data-testid="diff-summary">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";

  test("a document with references starts as their intersection", () => {
    const html = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={["lib/a.ts"]} />);
    expect(rows(html)).toEqual(["lib/a.ts"]);
  });

  test("the filtered list offers show all with the whole file count", () => {
    const html = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={["lib/a.ts"]} />);
    expect(html).toContain('data-testid="diff-show-all"');
    expect(html).toContain('href="?tab=pr&amp;all=1"');
    expect(html).toContain("show all 3 files");
  });

  test("show all expands the list and drops the footer", () => {
    const html = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={["lib/a.ts"]} showAll />);
    expect(rows(html)).toEqual(["docs/plan.md", "lib/a.ts", "lib/b.ts"]);
    expect(html).not.toContain("diff-show-all");
  });

  test("a document with no references keeps every file and no footer", () => {
    const html = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={[]} />);
    expect(rows(html)).toHaveLength(3);
    expect(html).not.toContain("diff-show-all");
  });

  test("references that already cover the snapshot are not a filter", () => {
    const html = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={["docs/plan.md", "lib/a.ts", "lib/b.ts"]} />);
    expect(rows(html)).toHaveLength(3);
    expect(html).not.toContain("diff-show-all");
  });

  test("the summary keeps whole-PR totals in both states", () => {
    const whole = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={[]} />);
    const filtered = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={["lib/a.ts"]} />);
    const expanded = renderToStaticMarkup(<DiffPanel index={index()} selected={null} refs={["lib/a.ts"]} showAll />);
    expect(summary(filtered)).toBe(summary(whole));
    expect(summary(expanded)).toBe(summary(whole));
    expect(summary(whole)).toContain("3 files");
    expect(summary(whole)).toContain("+6");
    expect(summary(whole)).toContain("−5");
  });

  test("a selected snippet keeps the whole-PR back count", () => {
    const html = renderToStaticMarkup(<DiffPanel index={index()} selected={{ path: "docs/plan.md", start: 2, end: 4 }} refs={["lib/a.ts"]} />);
    expect(html).toContain('data-testid="diff-snippet"');
    expect(html).toContain("‹ 3 files");
  });
});
});

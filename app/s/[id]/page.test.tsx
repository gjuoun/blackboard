import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffPanel } from "@/components/DiffPanel";
import { fileHref, parseSelectedFile } from "@/lib/file-refs";
import { renderMarkdown } from "@/lib/markdown";
import { snapshot } from "@/lib/test-diff";

/** The page's server assembly: one snapshot -> link rewriting -> the Local PR pane. */
async function pageHtml(search: { file?: string; L?: string }, tab: "pr" | "comments" = "pr") {
  const index = snapshot();
  const selected = parseSelectedFile(search, "docs/plan.md");
  const md = await renderMarkdown("See [the range](file:docs/plan.md:L2-L5) and [self](file:L9-3).", {
    fileLinks: { index, docPath: "docs/plan.md", selected },
  });
  const panel = renderToStaticMarkup(<DiffPanel index={index} selected={selected} />);
  return { md: md.html, panel, selected, tab };
}

describe("session page server render", () => {
  test("the file list is in the first HTML with the base chip and counts", async () => {
    const { panel } = await pageHtml({});
    expect(panel).toContain('data-testid="diff-file-list"');
    expect(panel).toContain('data-testid="diff-base"');
    expect(panel).toContain("base main @ abc1234");
    expect(panel).toContain('data-testid="diff-summary"');
    expect(panel).toContain("+3");
    expect(panel).toContain("docs/plan.md");
    expect(panel).not.toContain("<script");
  });

  test("a selected range renders a snippet first, with line anchors and diff classes", async () => {
    const { panel, selected } = await pageHtml({ file: "docs/plan.md", L: "L2-L5" });
    expect(selected).toEqual({ path: "docs/plan.md", start: 2, end: 5 });
    expect(panel).toContain('data-testid="diff-snippet"');
    expect(panel).toContain('data-testid="snippet-path"');
    expect(panel).toContain("L2-L5");
    expect(panel).toContain("in range");
    expect(panel).toContain('class="dl add inr" id="L3"');
    expect(panel).toContain('class="dl del inr" id="Lold3"');
    expect(panel).toContain('data-testid="snippet-whole-file"');
    expect(panel).toContain(fileHref("docs/plan.md", null).replace("&", "&amp;"));
  });

  test("a selected file without a range shows the whole-file diff", async () => {
    const { panel } = await pageHtml({ file: "docs/plan.md" });
    expect(panel).toContain('data-testid="diff-file"');
    expect(panel).toContain("@@ -2,3 +2,4 @@ render()");
  });

  test("markdown file links point at the session query and paint active", async () => {
    const { md } = await pageHtml({ file: "docs/plan.md", L: "L2-L5" });
    expect(md).toContain("href=\"?tab=pr&#x26;file=docs%2Fplan.md&#x26;L=L2-L5\"");
    expect(md).toContain("aria-current=\"true\"");
    expect(md).toContain("href=\"?tab=pr&#x26;file=docs%2Fplan.md&#x26;L=L3-L9\"");
  });

  test("a document outside git still renders the comments rail without a snapshot", () => {
    const html = renderToStaticMarkup(<DiffPanel index={null} selected={null} />);
    expect(html).toContain("Local PR is available for documents inside a git repository.");
  });
});

import { describe, expect, test } from "bun:test";
import { renderMarkdown, renderPlainText } from "./markdown";

const FENCE = "```";

describe("renderMarkdown", () => {
  test("renders a GFM table with a header row", async () => {
    const { html } = await renderMarkdown("| Key | Value |\n|-----|-------|\n| a | 1 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Key</th>");
    expect(html).toContain("<td>1</td>");
  });

  test("gives headings ids and lists h1-h3 in the toc", async () => {
    const { html, toc } = await renderMarkdown("# Design\n\n## Data flow\n\n### Edge cases\n\n#### Too deep\n");
    expect(html).toContain('<h2 id="data-flow">Data flow</h2>');
    expect(toc).toEqual([
      { depth: 1, id: "design", text: "Design" },
      { depth: 2, id: "data-flow", text: "Data flow" },
      { depth: 3, id: "edge-cases", text: "Edge cases" },
    ]);
  });

  test("turns ==passage==[^n] into a read-only mark titled with the footnote", async () => {
    const { html } = await renderMarkdown("This is ==an old mark==[^1] here.\n\n[^1]: legacy note\n");
    expect(html).toContain('<mark class="legacy-mark" data-testid="legacy-mark" title="legacy note">an old mark</mark>');
    expect(html).toContain("here.");
    expect(html).not.toContain("==an old mark==");
  });

  test("turns ==passage== without a footnote into an untitled mark", async () => {
    const { html } = await renderMarkdown("A ==plain mark== b.\n");
    expect(html).toContain('<mark class="legacy-mark" data-testid="legacy-mark">plain mark</mark>');
  });

  test("turns a mermaid fence into a placeholder that keeps the source", async () => {
    const { html } = await renderMarkdown(FENCE + "mermaid\nflowchart LR\n  A --> B\n" + FENCE + "\n");
    expect(html).toContain('data-testid="mermaid"');
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain("language-mermaid");
  });

  test("renders front matter as a field table that keeps arrays and nesting", async () => {
    const src = [
      "---",
      "id: PLAN-42",
      "status: In Progress",
      "created: 2026-09-24",
      "tags:",
      "  - search",
      "  - auth",
      "sub_issue: []",
      "pr: \"\"",
      "owner:",
      "  name: jun",
      "  team: core",
      "---",
      "",
      "# Body",
    ].join("\n");
    const { html, frontmatter } = await renderMarkdown(src);
    expect(frontmatter).toEqual({ id: "PLAN-42", status: "In Progress", created: "2026-09-24", tags: ["search", "auth"], sub_issue: [], pr: "", owner: { name: "jun", team: "core" } });
    expect(html.startsWith('<table class="frontmatter" data-testid="frontmatter">')).toBe(true);
    expect(html).toContain('<th scope="row">tags</th><td><ul class="fm-list"><li class="fm-chip">search</li><li class="fm-chip">auth</li></ul></td>');
    expect(html).toContain('<th scope="row">created</th><td>2026-09-24</td>');
    expect(html).toContain('<th scope="row">sub_issue</th><td></td>');
    expect(html).toContain('<th scope="row">pr</th><td></td>');
    expect(html).toContain('<th scope="row">owner</th><td><table class="fm-nested"><tbody><tr><th scope="row">name</th><td>jun</td></tr>');
    expect(html).not.toContain("<hr>");
    expect(html).toContain('<h1 id="body">Body</h1>');
  });

  test("shows front matter it cannot parse as source, with the error", async () => {
    const { html, frontmatter } = await renderMarkdown("---\ntags: [unclosed\n---\n\ntext\n");
    expect(frontmatter).toBeNull();
    expect(html).toContain('class="frontmatter-error"');
    expect(html).toContain("tags: [unclosed");
  });

  test("plain text skips mermaid and keeps the text between blocks", async () => {
    const text = await renderPlainText("# Title\n\nPara one.\n\n" + FENCE + "mermaid\nflowchart LR\n  A --> B\n" + FENCE + "\n\nPara two.\n");
    expect(text).toBe("Title\nPara one.\n\nPara two.");
  });

  test("escapes raw HTML instead of rendering it", async () => {
    const { html } = await renderMarkdown("<script>alert(1)</script>\n\nok\n");
    expect(html).not.toContain("<script>");
  });
});

describe("renderMarkdown assetBase", () => {
  const DOC = "![shot](./shot.png) ![up](../assets/up.png) ![web](https://x.test/a.png) ![inline](data:image/png;base64,xx) ![sub](sub/dir/b.jpg)";

  test("rewrites doc-relative img srcs onto the asset route", async () => {
    const { html } = await renderMarkdown(DOC, { assetBase: "/api/asset/abc123" });
    expect(html).toContain('src="/api/asset/abc123?p=shot.png"');
    expect(html).toContain('src="/api/asset/abc123?p=..%2Fassets%2Fup.png"');
    expect(html).toContain('src="/api/asset/abc123?p=sub%2Fdir%2Fb.jpg"');
    expect(html).toContain('src="https://x.test/a.png"');
    expect(html).toContain('src="data:image/png;base64,xx"');
  });

  test("without assetBase every src is left untouched", async () => {
    const { html } = await renderMarkdown(DOC);
    expect(html).toContain('src="./shot.png"');
    expect(html).toContain('src="../assets/up.png"');
    expect(html).not.toContain("/api/asset/");
  });
});

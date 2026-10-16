import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

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

  test("escapes raw HTML instead of rendering it", async () => {
    const { html } = await renderMarkdown("<script>alert(1)</script>\n\nok\n");
    expect(html).not.toContain("<script>");
  });
});

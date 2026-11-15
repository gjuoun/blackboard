import { describe, expect, test } from "bun:test";
import { codeMarkdown, renderCode } from "./code-view";

describe("code view", () => {
  test("code-view: fence inside file stays text", async () => {
    const src = "const a = `x`;\n```\nnot a fence\n```\n";
    const { html } = await renderCode(src, "lib/a.ts");
    expect(html).toContain("not a fence");
    // the outer block is one <pre>; the inner fence text is escaped inside it
    expect(html.match(/<pre/g)?.length).toBe(1);
    expect(html).not.toContain("<h1");
  });

  test("code-view: highlights a tsx token", async () => {
    const { html } = await renderCode("const n: number = 1;\n", "app/page.tsx");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("class=\"code-file\"");
  });

  test("code-view: fence longer than any run in the file", () => {
    const md = codeMarkdown("a ``` b", "x.ts");
    expect(md.startsWith("````ts\n")).toBe(true);
  });
});

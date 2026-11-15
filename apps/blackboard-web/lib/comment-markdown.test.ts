import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCommentBody, renderComments } from "./comment-markdown";

const TICK = String.fromCharCode(96);
const SRC = [
  "**bold** and " + TICK + "code" + TICK + " and [spec](https://example.com/spec) and $x^2$",
  "",
  "- item one",
  "- item two",
  "",
  TICK.repeat(3) + "ts",
  "const n: number = 1;",
  TICK.repeat(3),
].join("\n");

describe("renderCommentBody", () => {
  test("markdown becomes real nodes with no literal markers left", () => {
    const html = renderCommentBody(SRC);
    for (const tag of ["<strong>", "<code", "<ul>", "<pre", "katex", "<a "]) expect(html).toContain(tag);
    expect(html).not.toContain("**");
    expect(html).not.toContain(TICK);
    expect(html).not.toContain("$x^2$");
  });

  test("a link to an allowed scheme opens in a new tab without a handle back", () => {
    const html = renderCommentBody("[spec](https://example.com/spec)");
    expect(html).toContain('href="https://example.com/spec"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  test("raw HTML is shown as text, never parsed", () => {
    const html = renderCommentBody("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<[^>]*onerror/);
    expect(html).toContain("&#x3C;img");
    expect(renderCommentBody("<script>alert(1)</script>")).not.toContain("<script");
  });

  test("a javascript: link keeps its text and loses the href", () => {
    const html = renderCommentBody("[x](javascript:alert(1))");
    expect(html).toBe("<p>x</p>");
    expect(html).not.toMatch(/javascript:/i);
  });

  test("an entity-encoded javascript: link is still dropped", () => {
    const html = renderCommentBody("[y](&#106;avascript:alert(1))");
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain("href");
  });

  test("an image becomes its alt text; comments never fetch pictures", () => {
    const html = renderCommentBody("![alt text](https://evil.example/p.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("alt text");
  });

  test("a newline inside a paragraph is a line break", () => {
    expect(renderCommentBody("line one\nline two")).toBe("<p>line one<br>\nline two</p>");
  });
});

describe("renderComments", () => {
  test("renders the comment and each reply, keeping raw bodies alongside", () => {
    const [c] = renderComments([{ id: "c_1", quote: { exact: "q", prefix: "", suffix: "" }, body: "**hi**", author: "jun", createdAt: "t", status: "open", replies: [{ id: "r_1", body: "`yo`", author: "agent", createdAt: "t" }] }]);
    expect(c.body).toBe("**hi**");
    expect(c.html).toContain("<strong>hi</strong>");
    expect(c.replies[0].body).toBe("`yo`");
    expect(c.replies[0].html).toContain("<code>yo</code>");
  });

  test("the render path reads no file: the module imports nothing from the filesystem", () => {
    const src = readFileSync(join(import.meta.dir, "comment-markdown.ts"), "utf8");
    expect(src).not.toMatch(/from "node:fs"|readFileSync|existsSync|statSync|openSync/);
  });
});

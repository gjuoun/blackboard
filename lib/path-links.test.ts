import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMarkdown } from "./markdown";

const FENCE = "```";
const savedHome = process.env.HOME;
let base = "";
let doc = "";

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "bb-path-links-")));
  const repo = join(base, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "src", "foo.ts"), "export {};\n");
  writeFileSync(join(repo, "docs", "local.ts"), "export {};\n");
  doc = join(repo, "docs", "doc.md");
});

afterAll(() => {
  process.env.HOME = savedHome;
  rmSync(base, { recursive: true, force: true });
});

/** Every anchor that wraps a path link: its decoded href, title and code text. */
const links = (html: string) =>
  [...html.matchAll(/<a href="([^"]+)" title="([^"]*)" class="path-link" target="_blank" rel="noopener"><code>([^<]*)<\/code><\/a>/g)].map((m) => ({
    href: m[1].replaceAll("&#x26;", "&").replaceAll("&amp;", "&"),
    title: m[2],
    text: m[3],
  }));

describe("renderMarkdown path links", () => {
  test("inline code naming an existing file links to /api/open with the absolute path and line", async () => {
    const { html } = await renderMarkdown("See `src/foo.ts:42` and `local.ts`.\n", { docPath: doc });
    const found = links(html);
    expect(found.map((l) => l.text)).toEqual(["src/foo.ts:42", "local.ts"]);
    expect(found[0].href).toBe(`/api/open?p=${encodeURIComponent(join(base, "repo", "src", "foo.ts"))}&l=42`);
    expect(found[0].title).toBe(join(base, "repo", "src", "foo.ts") + ":42");
    expect(found[1].href).toBe(`/api/open?p=${encodeURIComponent(join(base, "repo", "docs", "local.ts"))}`);
    expect(found[1].title).toBe(join(base, "repo", "docs", "local.ts"));
  });

  test("a tilde path, an absolute path and a column number link too", async () => {
    process.env.HOME = join(base, "repo");
    const abs = join(base, "repo", "src", "foo.ts");
    const { html } = await renderMarkdown("`~/src/foo.ts` `" + abs + ":3:9`\n", { docPath: doc });
    const found = links(html);
    expect(found).toHaveLength(2);
    expect(found[1].href).toBe(`/api/open?p=${encodeURIComponent(abs)}&l=3&c=9`);
    expect(found[1].title).toBe(abs + ":3:9");
  });

  test("missing files, prose, fenced blocks and paths outside the sandbox stay plain", async () => {
    const src = [
      "Prose mentions src/foo.ts without code.",
      "",
      "Missing: `src/nope.ts`. Escape: `../../../../etc/passwd`.",
      "",
      FENCE,
      "open src/foo.ts here",
      FENCE,
      "",
    ].join("\n");
    const { html } = await renderMarkdown(src, { docPath: doc });
    expect(links(html)).toEqual([]);
    expect(html).not.toContain("/api/open");
    expect(html).toContain("<code>src/nope.ts</code>");
  });

  test("a code span inside an existing link keeps the link and gets no nested anchor", async () => {
    const { html } = await renderMarkdown("[`src/foo.ts`](https://example.com)\n", { docPath: doc });
    expect(html).not.toContain("/api/open");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  test("the rendered HTML has no script tag", async () => {
    const { html } = await renderMarkdown("`src/foo.ts:1` and `local.ts`\n", { docPath: doc });
    expect(links(html)).toHaveLength(2);
    expect(html).not.toMatch(/<script/i);
  });

  test("without a docPath no code span becomes a link", async () => {
    const { html } = await renderMarkdown("`src/foo.ts:42`\n");
    expect(html).not.toContain("/api/open");
  });
});

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

// The subject is the built artifact, not the source: these cases read dist/ after a real build, so
// a route that stops being generated, a dictionary that leaks into the other language, or a font
// subset that goes missing fails here instead of in the browser.
const appDir = join(import.meta.dir, "..");
const dist = join(appDir, "dist");
const page = (rel: string) => readFileSync(join(dist, rel, "index.html"), "utf8");

beforeAll(async () => {
  const run = await $`bun run build`.cwd(appDir).quiet().nothrow();
  if (run.exitCode !== 0) throw new Error(`build failed:\n${run.stderr.toString()}`);
}, 120_000);

describe("routes and languages", () => {
  test("English at / and Chinese at /zh/", () => {
    expect(existsSync(join(dist, "index.html"))).toBe(true);
    expect(existsSync(join(dist, "zh", "index.html"))).toBe(true);
  });

  test("each page declares its own lang", () => {
    expect(page("")).toContain('lang="en"');
    expect(page("zh")).toContain('lang="zh-CN"');
  });

  test("the two pages carry their own title, description and hero copy", () => {
    expect(page("")).toContain("Blackboard — review markdown with your coding agent");
    expect(page("")).toContain("Plan review, back in the document.");
    expect(page("zh")).toContain("Blackboard — 和你的编程 agent 一起评审 markdown");
    expect(page("zh")).toContain("把方案评审，搬回文档里。");
  });
});

describe("the language switcher", () => {
  test("English links to /zh/, Chinese links back to /", () => {
    expect(page("")).toContain('href="/zh/"');
    expect(page("zh")).toContain('href="/"');
  });

  test("the retired zh.html path is not linked from either page", () => {
    expect(page("")).not.toContain("zh.html");
    expect(page("zh")).not.toContain("zh.html");
  });
});

describe("per-locale assets", () => {
  test("each page shows its own screenshots", () => {
    expect(page("")).toContain("/assets/doc.png");
    expect(page("")).toContain("/assets/inbox.png");
    expect(page("zh")).toContain("/assets/doc-zh.png");
    expect(page("zh")).toContain("/assets/inbox-zh.png");
    expect(page("")).not.toContain("doc-zh.png");
    expect(page("zh")).not.toContain("/assets/doc.png");
    // The retired Sessions home never advertises itself — its screenshots are gone.
    expect(page("")).not.toContain("home.png");
    expect(page("zh")).not.toContain("home-zh.png");
  });

  test("each page loads its own font subsets", () => {
    for (const name of ["sans", "sans-bold", "mono", "mono-bold"]) {
      expect(page("")).toContain(`/fonts/qb-${name}-en.woff2`);
      expect(page("zh")).toContain(`/fonts/qb-${name}-zh.woff2`);
    }
  });

  test("the phone demo mounts in each locale with its own copy", () => {
    expect(page("")).toContain('data-slot="demo-root"');
    expect(page("zh")).toContain('data-slot="demo-root"');
    expect(page("")).toContain("Try it on the phone");
    expect(page("zh")).toContain("手机上试一试");
    // the island ships its dict as props — English rows must not leak into the zh page
    expect(page("")).toContain("Q1 launch plan");
    expect(page("zh")).toContain("Q1 发布计划");
  });

  test("the ui-mock page ships but stays unlisted", () => {
    expect(existsSync(join(dist, "ui-mock", "index.html"))).toBe(true);
    expect(readFileSync(join(dist, "ui-mock", "index.html"), "utf8")).toContain("noindex");
    expect(page("")).not.toContain("ui-mock");
    expect(page("zh")).not.toContain("ui-mock");
  });

  test("every root-absolute asset reference resolves inside dist", () => {
    const refs = new Set<string>();
    for (const html of [page(""), page("zh")]) {
      // Both the markup's href/src and the inlined stylesheet's url(...) carry asset paths.
      const matches = [
        ...html.matchAll(/(?:href|src)="(\/[^"]+)"/g),
        ...html.matchAll(/url\(\s*(\/[^)\s]+)\s*\)/g),
      ];
      for (const m of matches) {
        const ref = (m[1] as string).split("?")[0] as string;
        if (/^\/(?:_astro|assets|fonts)\//.test(ref)) refs.add(ref);
      }
    }
    // Eight font subsets, four screenshots and the bundled stylesheet,
    // all distinct across the two pages.
    expect(refs.size).toBe(13);
    const missing = [...refs].filter((ref) => !existsSync(join(dist, ref)));
    expect(missing).toEqual([]);
  });
});

describe("the deployed shape", () => {
  test("_redirects keeps the old paths alive", () => {
    const rules = readFileSync(join(dist, "_redirects"), "utf8");
    expect(rules).toContain("/zh.html /zh/ 301");
    expect(rules).toContain("/index.html / 301");
  });

  test("the two legacy html files are gone from both the source and the build", () => {
    expect(existsSync(join(appDir, "index.html"))).toBe(false);
    expect(existsSync(join(appDir, "zh.html"))).toBe(false);
    expect(existsSync(join(dist, "zh.html"))).toBe(false);
  });

  test("the build ships nothing but the pages and their assets", () => {
    const top = readdirSync(dist).sort();
    expect(top).toEqual(["_astro", "_redirects", "assets", "fonts", "index.html", "ui-mock", "zh"]);
  });
});

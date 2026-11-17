import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The repo's own rules, as a test. Each case reads the source and asserts a property of the tree —
 * no mocks, no fixtures. A rule that is not asserted here is a rule nobody can break a build with,
 * and in this repo that meant a contract that drifted a year away from the code.
 *
 * `RATCHET_*` lists are debts, not exemptions: a ratchet only shrinks. Adding a path to one is a
 * decision that has to be argued in review.
 */

const APP = join(import.meta.dir, "..", "..", "..");
const ROOTS = ["lib", "api", "components", "src", "bin", "test"];

type Source = { path: string; text: string; lines: number };

function sources(): Source[] {
  const out: Source[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(APP, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "server", "dist", ".output", ".tanstack"].includes(entry.name)) continue;
        walk(rel);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = readFileSync(join(APP, rel), "utf8");
      out.push({ path: rel, text, lines: text.split("\n").length - (text.endsWith("\n") ? 1 : 0) });
    }
  };
  for (const root of ROOTS) walk(root);
  return out;
}

const ALL = sources();

/** 300 lines per file, hard cap — the generated migrations bundle is the only file exempt. */
const RATCHET_OVERSIZED = new Set([
  "bin/blackboard.ts",
  "components/CommentPanel.tsx",
  "components/DocView.tsx",
  "components/ReadingWorkspace.tsx",
  "lib/markdown.ts",
  "lib/prefs.ts",
  "lib/server-ctl.test.ts",
  "lib/server-ctl.ts",
  "lib/virtualize-dom.ts",
]);

/** Files still importing `effect`. The move to safe-ts shrinks this set; nothing may join it. */
const RATCHET_EFFECT = new Set<string>([]);

describe("layer direction", () => {
  test("lib/ never imports api/ or components/", () => {
    const offenders = ALL.filter(
      (s) =>
        s.path.startsWith("lib/") &&
        /from "(\.\.\/)+api\/|from "@\/api\/|from "(\.\.\/)+components\//.test(s.text),
    ).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  test("components/ may import lib/, never the other way (nor src/)", () => {
    const offenders = ALL.filter(
      (s) => s.path.startsWith("components/") && /from "(\.\.\/)+src\//.test(s.text),
    ).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  test("api/platform/ holds no literal try/catch — the effect boundary does the catching", () => {
    const offenders = ALL.filter(
      (s) =>
        s.path.startsWith("api/platform/") &&
        !s.path.endsWith(".test.ts") &&
        !s.path.endsWith(".test.tsx") &&
        /\btry\s*\{/.test(s.text),
    ).map((s) => s.path);
    expect(offenders).toEqual([]);
  });
});

describe("file size", () => {
  test("no file over 300 lines except the recorded debt, and the debt may not grow", () => {
    const over = ALL.filter((s) => s.lines > 300 && s.path !== "lib/db/migrations/bundled.ts")
      .map((s) => s.path)
      .sort();
    expect(over).toEqual([...RATCHET_OVERSIZED].sort());
  });

  test("the generated migrations bundle says it is generated", () => {
    const bundle = ALL.find((s) => s.path === "lib/db/migrations/bundled.ts");
    expect(bundle?.text.startsWith("//")).toBe(true);
    expect(bundle?.text).toContain("Regenerate with");
  });
});

describe("the Effect debt", () => {
  test("the set of files importing effect only shrinks", () => {
    const imports = ALL.filter((s) => /from "effect(\/|")/.test(s.text))
      .map((s) => s.path)
      .sort();
    expect(imports).toEqual([...RATCHET_EFFECT].sort());
  });
});

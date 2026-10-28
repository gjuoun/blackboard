import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown, renderPlainText } from "./markdown";

const FENCE = "```";
const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Each fenced sample is a real doc fence, one per language the card names, plus an unlabelled fence. */
const SAMPLES: Record<string, string> = {
  ts: "const answer: number = 42; // the answer\nexport function greet(name: string) { return `hi ${name}`; }",
  py: "def add(a, b):\n    return a + b  # sum",
  bash: "echo \"hello\" && ls -la $HOME",
  json: "{\"name\": \"x\", \"n\": 3, \"ok\": true}",
  md: "# Title\n- *item* and `code`",
};
const DOC = Object.entries(SAMPLES).map(([lang, code]) => FENCE + lang + "\n" + code + "\n" + FENCE).join("\n\n");

/** The inner HTML of the one <code> block a fence of this language renders to. */
function codeBlock(html: string, lang: string): string {
  const m = new RegExp(`<code class="hljs language-${lang}">([\\s\\S]*?)</code>`).exec(html);
  if (!m) throw new Error(`no highlighted ${lang} block in: ${html.slice(0, 300)}`);
  return m[1];
}

describe("renderMarkdown code highlighting", () => {
  test("each labelled fence gets at least three distinct token scopes", async () => {
    const { html } = await renderMarkdown(DOC);
    for (const lang of Object.keys(SAMPLES)) {
      const scopes = new Set(codeBlock(html, lang).match(/hljs-[\w-]+/g) ?? []);
      expect({ lang, distinct: scopes.size >= 3 }).toEqual({ lang, distinct: true });
    }
  });

  test("a token span is a plain span, so the block keeps its <pre> and text", async () => {
    const { html } = await renderMarkdown(FENCE + "py\ndef add(a, b):\n    return a + b\n" + FENCE + "\n");
    expect(html).toContain('<pre><code class="hljs language-py"><span class="hljs-keyword">def</span> <span class="hljs-title function_">add</span>');
    expect(html).not.toMatch(/<(script|style|link)\b/);
  });

  test("a fence without a language stays plain text, never guessed", async () => {
    const { html } = await renderMarkdown(FENCE + "\nconst plain = 'no language tag';\n" + FENCE + "\n");
    expect(html).toContain("<pre><code>const plain = 'no language tag';");
    expect(html).not.toContain("hljs");
  });

  test("an unknown language label is left alone, not an error", async () => {
    const { html } = await renderMarkdown(FENCE + "nosuchlang\nlet x = 1;\n" + FENCE + "\n");
    expect(html).toContain("<pre><code class=\"hljs language-nosuchlang\">let x = 1;");
    expect(html).not.toMatch(/hljs-/);
  });

  test("the plain text a comment anchors against is unchanged by highlighting", async () => {
    const text = await renderPlainText(DOC);
    expect(text).toBe([
      "const answer: number = 42; // the answer",
      "export function greet(name: string) { return `hi ${name}`; }",
      "",
      "def add(a, b):",
      "    return a + b  # sum",
      "",
      "echo \"hello\" && ls -la $HOME",
      "",
      "{\"name\": \"x\", \"n\": 3, \"ok\": true}",
      "",
      "# Title",
      "- *item* and `code`",
    ].join("\n") + "\n");
  });
});

/** WCAG 2.1 contrast for sRGB hex, as in lib/theme.test.ts. */
function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const CSS = read("app/syntax.css").replace(/\/\*[\s\S]*?\*\//g, "");
const THEMES = read("app/themes.css").replace(/\/\*[\s\S]*?\*\//g, "");
const GLOBALS = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** token -> hex for one palette block of themes.css. */
function palette(id: string): Map<string, string> {
  const block = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`).exec(THEMES);
  if (!block) throw new Error("no palette " + id);
  return new Map([...block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
}

/** Each hljs scope rule: the token it reads from the palette, which must be one of the hue tokens. */
const HUE_TOKENS = ["primary", "success", "warn", "destructive", "muted-foreground", "foreground"];

/** The diff half of globals.css: everything from the explicit file-link rules down. */
const DIFF_CSS = GLOBALS.slice(GLOBALS.indexOf(".doc-body a.file-ref"));
const PALETTE_TOKENS = new Set([...THEMES.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]).concat(["font-code", "bar-h", "radius"]));

describe("diff palette mapping", () => {
  test("the diff and tab selectors use palette tokens only, never a literal colour", () => {
    expect(DIFF_CSS.length).toBeGreaterThan(1000);
    expect(DIFF_CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(DIFF_CSS).not.toMatch(/rgba?\(|hsla?\(/i);
    const used = new Set([...DIFF_CSS.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]));
    for (const t of used) expect({ t, ok: PALETTE_TOKENS.has(t) }).toEqual({ t, ok: true });
  });

  test("add/delete rows take their backgrounds from the semantic soft tokens", () => {
    expect(GLOBALS).toMatch(/\.dl\.add \{ background: var\(--success-soft\); \}/);
    expect(GLOBALS).toMatch(/\.dl\.del \{ background: var\(--destructive-soft\); \}/);
    expect(GLOBALS).toMatch(/\.dl\.add \.tk-t \{ color: var\(--primary\); \}/);
  });

  test("the monospace diff region never turns italic", () => {
    expect(GLOBALS).toMatch(/\.dv \{/);
    expect(GLOBALS).toMatch(/\.dv :is\(em, i\) \{ font-style: normal; \}/);
    expect(GLOBALS).not.toMatch(/\.dv[^{]*\{[^}]*font-style: italic/);
  });

  test("the active right tab carries a primary top line", () => {
    expect(GLOBALS).toMatch(/\.rail-tab\[aria-selected="true"\][^}]*box-shadow: inset 0 2px 0 var\(--primary\)/);
  });
});

describe("syntax palette mapping", () => {
  test("the stylesheet uses palette tokens only, never a literal colour", () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CSS).not.toMatch(/rgba?\(/i);
    expect(CSS).not.toMatch(/@import|url\(/);
    const used = new Set([...CSS.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]));
    for (const t of used) expect({ t, ok: HUE_TOKENS.includes(t) }).toEqual({ t, ok: true });
  });

  test("every palette keeps each mapped syntax colour at AA on the code block card", () => {
    for (const id of ["paper", "plain", "night"]) {
      const p = palette(id);
      const card = p.get("card")!;
      for (const t of HUE_TOKENS) {
        const hex = p.get(t)!;
        const r = ratio(hex, card);
        expect({ id, t, ok: r >= 4.5 }).toEqual({ id, t, ok: true });
      }
    }
  });
});

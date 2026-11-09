import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEMES, DEFAULT_THEME, themeById } from "./theme";
import { THEME_IDS, THEME_MODE } from "./prefs";

const read = (rel: string) => readFileSync(join(import.meta.dir, "..", rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const THEME_CSS = read("app/themes.css");
const COMPOSITE_CSS = read("app/theme/composite.css");

/** The shadcn vocabulary a themes.css block is allowed to declare — nothing more, nothing less. */
const SHADCN = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "radius"] as const;
const COMPOSITE = ["primary-soft", "code", "mark", "mark-line", "hl", "hl-hover", "hl-active", "warn", "success", "success-soft", "destructive-soft"] as const;

type Block = { id: string; scheme: string; tokens: Map<string, string> };

/** Every `[data-theme="x"] { … }` block, token by token, plus the color-scheme it declares. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  for (const m of css.matchAll(/\[data-theme="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
    const tokens = new Map<string, string>();
    for (const t of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens.set(t[1], t[2].trim());
    out.push({ id: m[1], scheme: /color-scheme\s*:\s*([a-z]+)/.exec(m[2])?.[1] ?? "", tokens });
  }
  return out;
}

const THEME_BLOCKS = blocks(THEME_CSS);
const COMPOSITE_BLOCKS = blocks(COMPOSITE_CSS);

/** One merged palette per id: the shadcn block from themes.css plus the composite block. */
const BLOCKS: Block[] = THEME_BLOCKS.map((b) => {
  const extra = COMPOSITE_BLOCKS.find((c) => c.id === b.id);
  if (!extra) throw new Error("no composite block for " + b.id);
  return { id: b.id, scheme: b.scheme, tokens: new Map([...b.tokens, ...extra.tokens]) };
});
const byId = (id: string) => BLOCKS.find((b) => b.id === id)!;
const token = (id: string, key: string) => byId(id).tokens.get(key) ?? "";

/** WCAG 2.1 relative luminance and contrast for sRGB hex. */
function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Tokens used as text or as a text background; rgba() tokens (`--hl`) are decorative and exempt. */
const GUARDED = ["background", "foreground", "muted-foreground", "primary", "primary-foreground", "warn", "success", "success-soft", "destructive-soft", "code"] as const;

test("themes: registry matches the CSS blocks one-to-one", () => {
  expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
  expect(BLOCKS.map((b) => b.id).sort()).toEqual([...THEME_IDS].sort());
  expect(BLOCKS.length).toBe(THEME_IDS.length);
  expect(themeById(DEFAULT_THEME).id).toBe(DEFAULT_THEME);
  expect(themeById("nope").id).toBe(DEFAULT_THEME);
});

test("themes: every block is a complete self-contained token set", () => {
  // No token may live in a dark-only override: switching data-theme must replace everything.
  expect(THEME_CSS + COMPOSITE_CSS).not.toMatch(/\.dark\s*\{/);
  const reference = [...BLOCKS[0].tokens.keys()].sort();
  for (const b of BLOCKS) expect({ id: b.id, keys: [...b.tokens.keys()].sort() }).toEqual({ id: b.id, keys: reference });
  for (const b of BLOCKS) expect(b.tokens.has("radius")).toBe(true);
  // Every guarded token is a plain sRGB hex, so the gate below cannot be fooled by color-mix/rgba.
  for (const b of BLOCKS) for (const key of GUARDED) expect(b.tokens.get(key)).toMatch(/^#[0-9a-f]{6}$/i);
});

test("themes: themes.css carries only the shadcn vocabulary, composite.css only ours", () => {
  // themes.css is the drop-in surface for a stock shadcn theme: a block declares exactly the
  // shadcn set (plus color-scheme), nothing of ours; composite.css declares only our extras.
  for (const b of THEME_BLOCKS) expect({ id: b.id, keys: [...b.tokens.keys()].sort() }).toEqual({ id: b.id, keys: [...SHADCN].sort() });
  for (const b of COMPOSITE_BLOCKS) expect({ id: b.id, keys: [...b.tokens.keys()].sort() }).toEqual({ id: b.id, keys: [...COMPOSITE].sort() });
});

test("themes: diff add/delete backgrounds keep hue and body text at AA", () => {
  const pairs = [["success", "success-soft"], ["destructive", "destructive-soft"]] as const;
  for (const b of BLOCKS) {
    for (const [hue, soft] of pairs) {
      const bg = b.tokens.get(soft)!;
      expect({ id: b.id, soft, min: ratio(b.tokens.get(hue)!, bg) }).toEqual({ id: b.id, soft, min: expect.any(Number) });
      expect({ id: b.id, soft, hue: ratio(b.tokens.get(hue)!, bg) >= 4.5 }).toEqual({ id: b.id, soft, hue: true });
      expect({ id: b.id, soft, text: ratio(b.tokens.get("foreground")!, bg) >= 4.5 }).toEqual({ id: b.id, soft, text: true });
    }
  }
});

test("themes: warm-light keeps the palette that shipped as paper", () => {
  // Unchanged from the warm theme that shipped: the page must not read as a redesign.
  expect(token("warm-light", "background")).toBe("#faf8f5");
  expect(token("warm-light", "foreground")).toBe("#2b2622");
  expect(token("warm-light", "card")).toBe("#ffffff");
  expect(token("warm-light", "secondary")).toBe("#f1ebe4");
  expect(token("warm-light", "border")).toBe("#ebe5de");
  expect(token("warm-light", "code")).toBe("#f6f2ed");
  expect(token("warm-light", "mark")).toBe("#fbe9a6");
  // The two that measured 3.61 and 3.89 against the paper background.
  expect(token("warm-light", "muted-foreground")).toBe("#6f675e");
  expect(token("warm-light", "primary")).toBe("#b3532f");
});

test("themes: a family shares one hue and the two modes share one set of shapes", () => {
  // Only colours change between blocks: the radius is the same in all four.
  for (const b of BLOCKS) expect({ id: b.id, radius: b.tokens.get("radius") }).toEqual({ id: b.id, radius: "0.75rem" });
  // The cold family is built on the viewpoint blue; the warm one on terracotta.
  expect(token("cold-light", "primary")).toBe("#3074bf");
  expect(token("cold-dark", "primary")).toBe("#58a6ff");
  expect(token("warm-dark", "primary")).toBe("#e0805a");
  // Each block declares the scheme its mode implies, so the browser paints its own scrollbars and
  // form controls in that mode rather than the platform default.
  for (const b of BLOCKS) expect({ id: b.id, scheme: b.scheme }).toEqual({ id: b.id, scheme: THEME_MODE[b.id as keyof typeof THEME_MODE] });
});

test("themes: every palette passes the contrast gate", () => {
  for (const b of BLOCKS) {
    const r = {
      fg: ratio(token(b.id, "foreground"), token(b.id, "background")),
      muted: ratio(token(b.id, "muted-foreground"), token(b.id, "background")),
      primary: ratio(token(b.id, "primary"), token(b.id, "background")),
      onPrimary: ratio(token(b.id, "primary-foreground"), token(b.id, "primary")),
      warn: ratio(token(b.id, "warn"), token(b.id, "background")),
      success: ratio(token(b.id, "success"), token(b.id, "background")),
      code: ratio(token(b.id, "foreground"), token(b.id, "code")),
    };
    console.log(
      b.id + " fg " + r.fg.toFixed(2) + " muted " + r.muted.toFixed(2) + " primary " + r.primary.toFixed(2) +
      " onPrimary " + r.onPrimary.toFixed(2) + " warn " + r.warn.toFixed(2) + " success " + r.success.toFixed(2) + " code " + r.code.toFixed(2),
    );
    expect({ id: b.id, fg: r.fg >= 7 }).toEqual({ id: b.id, fg: true });
    for (const k of ["muted", "primary", "onPrimary", "warn", "success", "code"] as const) {
      expect({ id: b.id, token: k, ok: r[k] >= 4.5 }).toEqual({ id: b.id, token: k, ok: true });
    }
  }
});

test("themes: switching a block replaces the whole palette", () => {
  const colour = [...BLOCKS[0].tokens.keys()].filter((k) => k !== "radius");
  for (let i = 0; i < BLOCKS.length; i++) {
    for (let j = i + 1; j < BLOCKS.length; j++) {
      const a = BLOCKS[i], b = BLOCKS[j];
      const differ = colour.filter((k) => a.tokens.get(k) !== b.tokens.get(k)).length;
      expect({ pair: a.id + "/" + b.id, differ: differ >= 10 }).toEqual({ pair: a.id + "/" + b.id, differ: true });
    }
  }
});

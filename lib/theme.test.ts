import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { THEMES, DEFAULT_THEME, themeById } from "./theme";
import { MODES, THEME_IDS, type Mode, type ThemeId } from "./prefs";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** One CSS file per theme id under each directory: the shadcn layer and the composite layer. */
const themeCss = (dir: string, id: ThemeId) => read(`app/${dir}/${id}.css`);

const THEME_FILES = Object.fromEntries(THEME_IDS.map((id) => [id, themeCss("themes", id)]));
const COMPOSITE_FILES = Object.fromEntries(THEME_IDS.map((id) => [id, themeCss("theme", id)]));

/** The shadcn vocabulary a themes/<id>.css block is allowed to declare — nothing more, nothing less. */
const SHADCN = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "radius"] as const;
const COMPOSITE = ["primary-soft", "code", "mark", "mark-line", "hl", "hl-hover", "hl-active", "warn", "success", "success-soft", "destructive-soft"] as const;

type Block = { theme: ThemeId; mode: Mode; scheme: string; tokens: Map<string, string> };

/** The `[data-theme="x"][data-mode="y"] { … }` block of one mode inside a family file. */
function blockOf(css: string, theme: ThemeId, mode: Mode): Block {
  const m = new RegExp(`\\[data-theme="${theme}"\\]\\[data-mode="${mode}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no ${mode} block for ${theme}`);
  const tokens = new Map<string, string>();
  for (const t of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens.set(t[1], t[2].trim());
  return { theme, mode, scheme: /color-scheme\s*:\s*([a-z]+)/.exec(m[1])?.[1] ?? "", tokens };
}

/** One merged palette per theme x mode: the shadcn block plus the composite block. */
const BLOCKS: Block[] = THEME_IDS.flatMap((theme) =>
  MODES.map((mode) => {
    const base = blockOf(THEME_FILES[theme], theme, mode);
    const extra = blockOf(COMPOSITE_FILES[theme], theme, mode);
    return { theme, mode, scheme: base.scheme, tokens: new Map([...base.tokens, ...extra.tokens]) };
  }),
);
const block = (theme: ThemeId, mode: Mode) => BLOCKS.find((b) => b.theme === theme && b.mode === mode)!;
const token = (theme: ThemeId, mode: Mode, key: string) => block(theme, mode).tokens.get(key) ?? "";
const paletteId = (b: Block) => `${b.theme}/${b.mode}`;

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

test("themes: registry matches the theme files one-to-one", () => {
  expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
  expect(readdirSync(join(ROOT, "app/themes")).sort()).toEqual(THEME_IDS.map((id) => `${id}.css`).sort());
  expect(readdirSync(join(ROOT, "app/theme")).sort()).toEqual(THEME_IDS.map((id) => `${id}.css`).sort());
  expect(BLOCKS.length).toBe(THEME_IDS.length * MODES.length);
  expect(themeById(DEFAULT_THEME).id).toBe(DEFAULT_THEME);
  expect(themeById("nope").id).toBe(DEFAULT_THEME);
});

test("themes: every file carries both modes, each a complete token set", () => {
  // No token may live in a .dark-class override: data-mode must replace everything.
  for (const css of [...Object.values(THEME_FILES), ...Object.values(COMPOSITE_FILES)]) expect(css).not.toMatch(/\.dark\s*\{/);
  const reference = [...BLOCKS[0].tokens.keys()].sort();
  for (const b of BLOCKS) expect({ id: paletteId(b), keys: [...b.tokens.keys()].sort() }).toEqual({ id: paletteId(b), keys: reference });
  for (const b of BLOCKS) expect(b.tokens.has("radius")).toBe(true);
  // Every guarded token is a plain sRGB hex, so the gate below cannot be fooled by color-mix/rgba.
  for (const b of BLOCKS) for (const key of GUARDED) expect(b.tokens.get(key)).toMatch(/^#[0-9a-f]{6}$/i);
});

test("themes: themes/ files carry only the shadcn vocabulary, theme/ files only ours", () => {
  // The themes/ files are the drop-in surface for a stock shadcn theme: a block declares exactly
  // the shadcn set (plus color-scheme), nothing of ours; theme/ files declare only our extras.
  for (const theme of THEME_IDS) {
    for (const mode of MODES) {
      const base = blockOf(THEME_FILES[theme], theme, mode);
      expect({ id: paletteId(base), keys: [...base.tokens.keys()].sort() }).toEqual({ id: paletteId(base), keys: [...SHADCN].sort() });
      const extra = blockOf(COMPOSITE_FILES[theme], theme, mode);
      expect({ id: paletteId(extra), keys: [...extra.tokens.keys()].sort() }).toEqual({ id: paletteId(extra), keys: [...COMPOSITE].sort() });
    }
  }
});

test("themes: diff add/delete backgrounds keep hue and body text at AA", () => {
  const pairs = [["success", "success-soft"], ["destructive", "destructive-soft"]] as const;
  for (const b of BLOCKS) {
    for (const [hue, soft] of pairs) {
      const bg = b.tokens.get(soft)!;
      expect({ id: paletteId(b), soft, min: ratio(b.tokens.get(hue)!, bg) }).toEqual({ id: paletteId(b), soft, min: expect.any(Number) });
      expect({ id: paletteId(b), soft, hue: ratio(b.tokens.get(hue)!, bg) >= 4.5 }).toEqual({ id: paletteId(b), soft, hue: true });
      expect({ id: paletteId(b), soft, text: ratio(b.tokens.get("foreground")!, bg) >= 4.5 }).toEqual({ id: paletteId(b), soft, text: true });
    }
  }
});

test("themes: warm light keeps the palette that shipped as paper", () => {
  // Unchanged from the warm theme that shipped: the page must not read as a redesign.
  expect(token("warm", "light", "background")).toBe("#faf8f5");
  expect(token("warm", "light", "foreground")).toBe("#2b2622");
  expect(token("warm", "light", "card")).toBe("#ffffff");
  expect(token("warm", "light", "secondary")).toBe("#f1ebe4");
  expect(token("warm", "light", "border")).toBe("#ebe5de");
  expect(token("warm", "light", "code")).toBe("#f6f2ed");
  expect(token("warm", "light", "mark")).toBe("#fbe9a6");
  // The two that measured 3.61 and 3.89 against the paper background.
  expect(token("warm", "light", "muted-foreground")).toBe("#6f675e");
  expect(token("warm", "light", "primary")).toBe("#b3532f");
});

test("themes: a family shares one hue and the two modes share one set of shapes", () => {
  // Only colours change between blocks: the radius is the same in all four.
  for (const b of BLOCKS) expect({ id: paletteId(b), radius: b.tokens.get("radius") }).toEqual({ id: paletteId(b), radius: "0.75rem" });
  // The cold family is built on the viewpoint blue; the warm one on terracotta.
  expect(token("cold", "light", "primary")).toBe("#3074bf");
  expect(token("cold", "dark", "primary")).toBe("#58a6ff");
  expect(token("warm", "dark", "primary")).toBe("#e0805a");
  // Each block declares the scheme its mode implies, so the browser paints its own scrollbars and
  // form controls in that mode rather than the platform default.
  for (const b of BLOCKS) expect({ id: paletteId(b), scheme: b.scheme }).toEqual({ id: paletteId(b), scheme: b.mode });
});

test("themes: every palette passes the contrast gate", () => {
  for (const b of BLOCKS) {
    const t = (k: string) => token(b.theme, b.mode, k);
    const r = {
      fg: ratio(t("foreground"), t("background")),
      muted: ratio(t("muted-foreground"), t("background")),
      primary: ratio(t("primary"), t("background")),
      onPrimary: ratio(t("primary-foreground"), t("primary")),
      warn: ratio(t("warn"), t("background")),
      success: ratio(t("success"), t("background")),
      code: ratio(t("foreground"), t("code")),
    };
    console.log(
      paletteId(b) + " fg " + r.fg.toFixed(2) + " muted " + r.muted.toFixed(2) + " primary " + r.primary.toFixed(2) +
      " onPrimary " + r.onPrimary.toFixed(2) + " warn " + r.warn.toFixed(2) + " success " + r.success.toFixed(2) + " code " + r.code.toFixed(2),
    );
    expect({ id: paletteId(b), fg: r.fg >= 7 }).toEqual({ id: paletteId(b), fg: true });
    for (const k of ["muted", "primary", "onPrimary", "warn", "success", "code"] as const) {
      expect({ id: paletteId(b), token: k, ok: r[k] >= 4.5 }).toEqual({ id: paletteId(b), token: k, ok: true });
    }
  }
});

test("themes: switching theme or mode replaces the whole palette", () => {
  const colour = [...BLOCKS[0].tokens.keys()].filter((k) => k !== "radius");
  for (let i = 0; i < BLOCKS.length; i++) {
    for (let j = i + 1; j < BLOCKS.length; j++) {
      const a = BLOCKS[i], b = BLOCKS[j];
      const differ = colour.filter((k) => a.tokens.get(k) !== b.tokens.get(k)).length;
      expect({ pair: paletteId(a) + "/" + paletteId(b), differ: differ >= 10 }).toEqual({ pair: paletteId(a) + "/" + paletteId(b), differ: true });
    }
  }
});

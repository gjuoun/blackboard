/**
 * The theme vocabulary: which roles a palette must define, which themes exist, and the two DOM
 * attributes that carry the choice. No colours here — every hex lives in
 * `packages/bb-tokens/palette/palette.json`, and `scripts/gen-tokens.ts` turns the two into CSS.
 */

/** The shadcn roles a block declares. `radius` is a shape, not a colour, so it lives in styles.css. */
export const SHADCN_ROLES = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
  "accent", "accent-foreground", "destructive", "border", "input", "ring",
] as const;

/** Blackboard's own roles: the ones shadcn has no word for. They map in composite.css, not styles.css. */
export const COMPOSITE_ROLES = [
  "primary-soft", "code", "mark", "mark-line", "hl", "hl-hover", "hl-active",
  "warn", "success", "success-soft", "destructive-soft",
] as const;

/** Every role a palette block must define, and the generator enforces exactly this set. */
export const REQUIRED = [...SHADCN_ROLES, ...COMPOSITE_ROLES] as const;
export type Role = (typeof REQUIRED)[number];

export const THEME_IDS = ["warm", "cold"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];
export const DEFAULT_MODE: Mode = "light";

export type Theme = { id: ThemeId; label: string; isDefault: boolean };

/** The families, warm first: the grid and the picker read this order. */
export const THEMES: Theme[] = [
  { id: "warm", label: "Warm", isDefault: true },
  { id: "cold", label: "Cold", isDefault: false },
];

export const DEFAULT_THEME: ThemeId = "warm";

/**
 * Theme ids this version no longer defines — the retired paper/plain/night palettes and the combined
 * theme-mode ids from before the data-mode split — and the pair that replaced each. A stored record
 * is read through this map and written back as theme + mode, so a browser keeps its nearest
 * counterpart instead of snapping to the default.
 */
export const LEGACY_THEME: Record<string, { theme: ThemeId; mode: Mode }> = {
  paper: { theme: "warm", mode: "light" },
  plain: { theme: "cold", mode: "light" },
  night: { theme: "warm", mode: "dark" },
  "warm-light": { theme: "warm", mode: "light" },
  "warm-dark": { theme: "warm", mode: "dark" },
  "cold-light": { theme: "cold", mode: "light" },
  "cold-dark": { theme: "cold", mode: "dark" },
};

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Put the choice on `<html>`: the two attributes the generated CSS keys on. */
export function applyTheme(el: HTMLElement, theme: ThemeId, mode: Mode): void {
  el.setAttribute("data-theme", theme);
  el.setAttribute("data-mode", mode);
}
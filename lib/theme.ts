import { THEME_IDS, THEME_MODE, type ThemeId } from "./prefs";

/** A palette, as the picker needs it: the id the CSS uses, a label, and the mode it paints. */
type ThemeMeta = { id: ThemeId; label: string; mode: "light" | "dark" };

/** Two families x two modes, warm first: the grid and the picker read this order. */
export const THEMES: ThemeMeta[] = [
  { id: "warm-light", label: "Warm · Light", mode: THEME_MODE["warm-light"] },
  { id: "warm-dark", label: "Warm · Dark", mode: THEME_MODE["warm-dark"] },
  { id: "cold-light", label: "Cold · Light", mode: THEME_MODE["cold-light"] },
  { id: "cold-dark", label: "Cold · Dark", mode: THEME_MODE["cold-dark"] },
];

export const DEFAULT_THEME: ThemeId = "warm-light";

export const themeById = (id: string): ThemeMeta => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Every id the CSS must define a block for; re-exported so callers do not reach into prefs. */
export { THEME_IDS };

import { DEFAULT_MODE, MODES, THEME_IDS, type Mode, type ThemeId } from "./prefs";

/** A palette family, as the picker needs it: the id the CSS uses and a label. */
type ThemeMeta = { id: ThemeId; label: string };

/** The families, warm first: the grid and the picker read this order. */
export const THEMES: ThemeMeta[] = [
  { id: "warm", label: "Warm" },
  { id: "cold", label: "Cold" },
];

export const DEFAULT_THEME: ThemeId = "warm";

export const themeById = (id: string): ThemeMeta => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Every id the CSS must define a file for; re-exported so callers do not reach into prefs. */
export { THEME_IDS, MODES, DEFAULT_MODE };
export type { Mode, ThemeId };

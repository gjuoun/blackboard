import { THEME_IDS, THEME_MODE, type ThemeId } from "./prefs";

/** A palette, as the picker needs it: the id the CSS uses, a label, and the mode it paints. */
export type ThemeMeta = { id: ThemeId; label: string; mode: "light" | "dark" };

export const THEMES: ThemeMeta[] = [
  { id: "paper", label: "Paper", mode: THEME_MODE.paper },
  { id: "plain", label: "Plain", mode: THEME_MODE.plain },
  { id: "night", label: "Night", mode: THEME_MODE.night },
];

export const DEFAULT_THEME: ThemeId = "paper";

export const themeById = (id: string): ThemeMeta => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Every id the CSS must define a block for; re-exported so callers do not reach into prefs. */
export { THEME_IDS };

/** Themes the UI knows. Tokens live in app/themes.css; `<html data-theme>` selects one. */
export const THEMES = ["warm"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "warm";

"use client";

import { useEffect, useRef, useState } from "react";
import { MODES, THEMES, type Mode, type ThemeId } from "@gjuoun/bb-ui/themes";
import { ComponentsSection } from "./ComponentsSection";
import { PaletteSection } from "./PaletteSection";
import { TypeSection } from "./TypeSection";

/**
 * The two selectors at the top. They do what the app's own picker does: put `data-theme` and
 * `data-mode` on the document element, so the whole page resyncs — body background, the top bar,
 * every surface — not just the block under them. Leaving the page hands the document back to the
 * attributes the app booted with, so nothing is written to the stored preferences.
 */
export function CatalogBody() {
  const [theme, setTheme] = useState<ThemeId>("warm");
  const [mode, setMode] = useState<Mode>("light");
  const booted = useRef<{ theme: string | null; mode: string | null } | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    if (!booted.current) {
      booted.current = { theme: el.getAttribute("data-theme"), mode: el.getAttribute("data-mode") };
    }
    el.setAttribute("data-theme", theme);
    el.setAttribute("data-mode", mode);
  }, [theme, mode]);

  useEffect(() => {
    return () => {
      const el = document.documentElement;
      const before = booted.current;
      if (!before) return;
      if (before.theme) el.setAttribute("data-theme", before.theme);
      if (before.mode) el.setAttribute("data-mode", before.mode);
    };
  }, []);

  const select = "h-8 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground";

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Theme</span>
          <select
            aria-label="Theme"
            data-theme-select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeId)}
            className={select}
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Mode</span>
          <select
            aria-label="Mode"
            data-mode-select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className={select}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          The whole page resyncs — background, chrome, every surface below.
        </p>
      </div>

      <div data-preview data-theme={theme} data-mode={mode} className="flex flex-col gap-8">
        <PaletteSection theme={theme} mode={mode} />
        <TypeSection />
        <ComponentsSection />
      </div>
    </>
  );
}
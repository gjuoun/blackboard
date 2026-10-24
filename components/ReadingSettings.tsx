"use client";

import { Check, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CJK_FONTS, LATIN_FONTS, MONO_FONTS, type FontEntry } from "@/lib/fonts";
import { THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { resetReading, setChrome, useChrome } from "./chrome";

/**
 * Reading settings: the palette cards, the three pickers and a live specimen. Every control writes
 * through the chrome store, which paints <html> immediately and persists the record, so closing the
 * panel never loses a choice. The "installed" hint is a local() FontFace probe — the only reliable
 * test we found (document.fonts.check reported true for faces that were not there).
 *
 * Selected state is one style only: the card is drawn by aria-checked (border + a single ring), and
 * keyboard focus uses an outline, so a focused-and-selected card never shows two competing rings.
 */
export function ReadingSettings() {
  const chrome = useChrome();
  const [installed, setInstalled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, boolean> = {};
      for (const [slot, list] of [["latin", LATIN_FONTS], ["cjk", CJK_FONTS], ["mono", MONO_FONTS]] as const) {
        for (const f of list) {
          if (!f.postscript?.length) continue;
          out[slot + ":" + f.id] = false;
          for (const ps of f.postscript) {
            try {
              await new FontFace("probe" + Math.random(), 'local("' + ps + '")').load();
              out[slot + ":" + f.id] = true;
              break;
            } catch {
              // try the next PostScript name
            }
          }
        }
      }
      if (alive) setInstalled(out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hint = (slot: string, f: FontEntry<string>) => {
    const known = installed[slot + ":" + f.id];
    if (known === undefined) return null;
    return (
      <span className={cn("ml-1 text-[11px]", known ? "text-success" : "text-muted-foreground")} title={known ? "installed" : "not installed — falls back"}>
        {known ? "✓" : "—"}
      </span>
    );
  };

  const picker = (slot: "latin" | "cjk" | "mono", label: string, list: { id: string; label: string }[], value: string, onChange: (v: string) => void) => (
    <label className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <select
        data-testid={"font-" + slot}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background focus-visible:ring-ring/40 h-8 min-w-0 flex-1 rounded-lg border px-2 text-[13px] outline-none focus-visible:ring-[3px]"
      >
        {list.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Reading settings" title="Reading settings" data-testid="open-reading-settings" className="shrink-0">
          <Palette />
        </Button>
      </PopoverTrigger>
      <PopoverContent data-testid="reading-settings">
        <section aria-label="Theme">
          <h3 className="text-muted-foreground mb-1.5 text-xs font-semibold">Theme</h3>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1.5">
            {THEMES.map((t) => {
              const on = chrome.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid="theme-card"
                  data-theme-id={t.id}
                  onClick={() => setChrome({ theme: t.id })}
                  title={t.label + " · " + t.mode}
                  className={cn(
                    "border-border bg-card hover:bg-accent rounded-lg border p-1.5 text-left transition-colors outline-none",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    on && "border-primary ring-primary ring-1",
                  )}
                >
                  {/* The swatch carries its own data-theme, so it reads that palette's tokens. */}
                  <span data-theme={t.id} className="bg-background border-border mb-1 flex h-7 items-center gap-1 rounded-md border px-1.5">
                    <span className="bg-foreground size-1.5 rounded-full" />
                    <span className="bg-primary size-1.5 rounded-full" />
                    <span className="bg-muted-foreground size-1.5 rounded-full opacity-60" />
                  </span>
                  <span className="flex items-center justify-between gap-1 text-[12px] leading-tight font-medium">
                    {t.label}
                    {on ? <Check className="text-primary size-3.5" /> : null}
                  </span>
                  <span className="text-muted-foreground text-[10.5px]">{t.mode}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Reading fonts" className="mt-3 flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-xs font-semibold">Reading fonts</h3>
          {picker("latin", "Latin", LATIN_FONTS.map((f) => ({ id: f.id, label: f.label })), chrome.fontLatin, (v) => setChrome({ fontLatin: v as never }))}
          {picker("cjk", "中文", CJK_FONTS.map((f) => ({ id: f.id, label: f.label })), chrome.fontCjk, (v) => setChrome({ fontCjk: v as never }))}
          {picker("mono", "等宽", MONO_FONTS.map((f) => ({ id: f.id, label: f.label + (f.aligned ? "" : " (Latin only)") })), chrome.fontMono, (v) => setChrome({ fontMono: v as never }))}
          <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-0.5 text-[11px]">
            {LATIN_FONTS.filter((f) => f.postscript?.length).map((f) => (
              <span key={"l" + f.id}>{f.label}{hint("latin", f)}</span>
            ))}
            {CJK_FONTS.filter((f) => f.postscript?.length).map((f) => (
              <span key={"c" + f.id}>{f.label}{hint("cjk", f)}</span>
            ))}
            {MONO_FONTS.filter((f) => f.postscript?.length).map((f) => (
              <span key={"m" + f.id}>{f.label}{hint("mono", f)}</span>
            ))}
          </p>
        </section>

        <section className="border-border mt-3 border-t pt-2.5">
          <h3 className="text-muted-foreground mb-1 text-xs font-semibold">Specimen</h3>
          <div data-testid="font-specimen" className="reading-specimen bg-background border-border rounded-lg border px-2.5 py-2 text-[13.5px] leading-relaxed">
            The quick brown fox jumps over 0123456789 · 中文阅读体验，标点“引号”与《书名》 · <code>const 常量 = 1;</code>
          </div>
        </section>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-muted-foreground text-[11px]">Saved in this browser</span>
          <Button variant="outline" size="xs" data-testid="reading-reset" onClick={resetReading}>
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

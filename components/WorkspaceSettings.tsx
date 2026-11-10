"use client";

import { useState } from "react";
import { LATIN_FONTS } from "@/lib/fonts";
import { MODES, THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { DOC_SIZE_IDS, DOC_SIZE_LABEL } from "@/lib/prefs";
import { setChrome, useChrome } from "./chrome";

/** One settings row: label on the left, the current value and a chevron on the right. */
function Row({ label, value, onPress, testid }: { label: string; value: string; onPress?: () => void; testid?: string }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onPress}
      className="flex w-full items-center justify-between gap-2.5 px-3 py-2.5 text-left text-[13px] active:bg-accent [&:not(:first-child)]:shadow-[inset_0_1px_0_var(--border)]"
    >
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
        {value}
        <span aria-hidden className="text-sm opacity-50">
          ›
        </span>
      </span>
    </button>
  );
}

/** The small picker that opens under a row; a tap on an option writes it and closes. */
function Pick({ options, value, onPick }: { options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="bg-secondary flex gap-1 px-3 py-2 shadow-[inset_0_1px_0_var(--border)]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={cn("border-border bg-card h-7 flex-1 truncate rounded-lg border px-2 text-xs", value === o.id && "border-primary text-primary font-semibold")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A group: the mono uppercase label over one rounded card of rows. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-testid={`sg-${label.toLowerCase()}`} className="px-3 pt-3.5">
      <p className="text-muted-foreground mx-1 mb-1.5 font-mono text-[10px] tracking-[0.06em] uppercase">{label}</p>
      <div className="border-border bg-card overflow-hidden rounded-[10px] border">{children}</div>
    </div>
  );
}

/**
 * The global settings screen: one page for the palette, the fonts, the reading behaviour and the
 * app itself, reachable from the mobile tab bar and from the desktop gear. Every writable row goes
 * through the chrome store (`bb-chrome`), so a choice paints and persists on the tap.
 */
export function WorkspaceSettings({ repos, version }: { repos: string[]; version: string }) {
  const chrome = useChrome();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((v) => (v === key ? null : key));

  const theme = THEMES.find((t) => t.id === chrome.theme) ?? THEMES[0];
  const font = LATIN_FONTS.find((f) => f.id === chrome.fontLatin) ?? LATIN_FONTS[0];
  const repo = chrome.docRepo || "";

  return (
    <div data-testid="workspace-settings" className="pb-6">
      <Group label="Appearance">
        <Row label="Theme" value={theme.label} onPress={() => toggle("theme")} testid="sg-theme" />
        {open === "theme" ? <Pick options={THEMES.map((t) => ({ id: t.id, label: t.label }))} value={chrome.theme} onPick={(id) => setChrome({ theme: id as typeof chrome.theme })} /> : null}
        <Row label="Mode" value={chrome.mode === "dark" ? "Dark" : "Light"} onPress={() => toggle("mode")} testid="sg-mode" />
        {open === "mode" ? (
          <Pick options={MODES.map((m) => ({ id: m, label: m === "dark" ? "Dark" : "Light" }))} value={chrome.mode} onPick={(id) => setChrome({ mode: id as typeof chrome.mode })} />
        ) : null}
        <Row label="Font" value={font.label} onPress={() => toggle("font")} testid="sg-font" />
        {open === "font" ? <Pick options={LATIN_FONTS.map((f) => ({ id: f.id, label: f.label }))} value={chrome.fontLatin} onPick={(id) => setChrome({ fontLatin: id as typeof chrome.fontLatin })} /> : null}
        <Row label="Size" value={DOC_SIZE_LABEL[chrome.docSize]} onPress={() => toggle("size")} testid="sg-size" />
        {open === "size" ? (
          <Pick
            options={DOC_SIZE_IDS.map((id) => ({ id, label: DOC_SIZE_LABEL[id] }))}
            value={chrome.docSize}
            onPick={(id) => setChrome({ docSize: id as typeof chrome.docSize })}
          />
        ) : null}
      </Group>
      <Group label="Reading">
        <Row label="Open at" value={chrome.resumeOnOpen ? "Last position" : "Top"} onPress={() => setChrome({ resumeOnOpen: !chrome.resumeOnOpen })} testid="sg-resume" />
        <Row label="Mark read on open" value={chrome.markReadOnOpen ? "On" : "Off"} onPress={() => setChrome({ markReadOnOpen: !chrome.markReadOnOpen })} testid="sg-mark" />
        <Row label="Body width" value={chrome.textWidth === "wide" ? "Full width" : "Auto"} onPress={() => setChrome({ textWidth: chrome.textWidth === "wide" ? "fit" : "wide" })} testid="sg-width" />
      </Group>
      <Group label="Workspace">
        <Row label="Default repo" value={repo || "All repos"} onPress={() => toggle("repo")} testid="sg-repo" />
        {open === "repo" ? (
          <Pick
            options={[{ id: "", label: "All repos" }, ...repos.map((r) => ({ id: r, label: r }))]}
            value={repo}
            onPick={(id) => setChrome({ docRepo: id })}
          />
        ) : null}
        <Row label="Session storage" value="~/.blackboard" testid="sg-storage" />
      </Group>
      <Group label="About">
        <Row label="Blackboard" value={`v${version}`} testid="sg-version" />
        {/* TODO(JW-370): no update feed yet; the row is a placeholder until release checking exists. */}
        <Row label="Update check" value="Automatic" testid="sg-version-check" />
      </Group>
      <p className="text-muted-foreground mx-4 mt-3.5 text-[11px] leading-[1.65]">
        Global settings. Reading appearance lives under Appearance; every choice is saved in this browser.
      </p>
    </div>
  );
}

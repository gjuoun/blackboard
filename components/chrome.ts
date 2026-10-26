"use client";

import { useSyncExternalStore } from "react";
import { applyPrefs, DEFAULT_CHROME, parsePrefs, PREFS_KEY, serializePrefs, type StoredChrome } from "@/lib/prefs";

/**
 * Page chrome shared between the top bar (in the root layout) and the doc page: which side panels
 * are open, what the open doc is, and the reading preferences. Everything except `sheet` and `doc`
 * persists under `bb-chrome` — the same key the previous version wrote, so an upgrade keeps its
 * four booleans. On a phone the panels are bottom sheets, so `sheet` says which one is showing.
 */
export type DocInfo = { id: string; path: string; readable: boolean; hasToc: boolean; open: number };
export type Chrome = StoredChrome & { sheet: "toc" | "cm" | null; doc: DocInfo | null };

const DEFAULTS: Chrome = { ...DEFAULT_CHROME, sheet: null, doc: null };

let state: Chrome | null = null;
const listeners = new Set<() => void>();

function read(): Chrome {
  if (state === null) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(PREFS_KEY);
    } catch {
      // storage blocked: fall through to the defaults
    }
    state = { ...parsePrefs(raw), sheet: null, doc: null };
  }
  return state;
}

/** Write the record and paint it on <html>. Cheap enough to run on every change: 7 attributes. */
function commit(next: Chrome) {
  state = next;
  try {
    localStorage.setItem(PREFS_KEY, serializePrefs(next));
  } catch {
    // storage blocked: the choice lasts for this page
  }
  if (typeof document !== "undefined") applyPrefs(document.documentElement, next);
}

export function setChrome(patch: Partial<Chrome>) {
  const cur = read();
  const next = { ...cur, ...patch };
  if (!(Object.keys(patch) as (keyof Chrome)[]).some((k) => next[k] !== cur[k])) return;
  commit(next);
  for (const l of listeners) l();
}

/** Update the open doc's info in place (comment count, …). */
export function patchDoc(patch: Partial<DocInfo>) {
  const doc = read().doc;
  if (doc && Object.entries(patch).some(([k, v]) => doc[k as keyof DocInfo] !== v)) setChrome({ doc: { ...doc, ...patch } });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const useChrome = () => useSyncExternalStore(subscribe, read, () => DEFAULTS);

/** The breakpoint the side panels and the doc grid switch at (the CSS `md:` class uses the same px). */
export const DESKTOP = "(min-width: 768px)";
const subscribeMq = (l: () => void) => {
  const mq = matchMedia(DESKTOP);
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
};
/** Side panels sit beside the doc from 768px up; below that they open as bottom sheets. */
export const useIsDesktop = () =>
  useSyncExternalStore(
    subscribeMq,
    () => matchMedia(DESKTOP).matches,
    () => true,
  );

/** The top bar's Contents / Comments buttons: a side panel on desktop, a sheet on a phone. */
export function togglePanel(which: "toc" | "cm", desktop: boolean) {
  const c = read();
  if (desktop) setChrome(which === "toc" ? { tocOpen: !c.tocOpen } : { cmOpen: !c.cmOpen });
  else setChrome({ sheet: c.sheet === which ? null : which });
}

/** Reset the reading picks (palette, the three faces) without touching how the panels are laid out. */
export function resetReading() {
  setChrome({ theme: DEFAULTS.theme, fontLatin: DEFAULTS.fontLatin, fontCjk: DEFAULTS.fontCjk, fontMono: DEFAULTS.fontMono });
}


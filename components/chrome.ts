"use client";

import { useSyncExternalStore } from "react";

/**
 * Page chrome shared between the top bar (in the root layout) and the doc page: which side panels
 * are open, what the open doc is, and two reading options. Panel and option choices persist in
 * localStorage. On a phone the panels are bottom sheets, so `sheet` says which one is showing.
 */
export type DocInfo = { id: string; path: string; readable: boolean; hasToc: boolean; open: number };
export type Chrome = { tocOpen: boolean; cmOpen: boolean; sheet: "toc" | "cm" | null; showResolved: boolean; wrapCode: boolean; doc: DocInfo | null };

const KEY = "bb-chrome";
const DEFAULTS: Chrome = { tocOpen: true, cmOpen: true, sheet: null, showResolved: false, wrapCode: false, doc: null };
const PERSISTED = ["tocOpen", "cmOpen", "showResolved", "wrapCode"] as const;

let state: Chrome | null = null;
const listeners = new Set<() => void>();

function read(): Chrome {
  if (state === null) {
    let saved: Partial<Chrome> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      // ignore a corrupt value
    }
    state = { ...DEFAULTS };
    for (const k of PERSISTED) if (typeof saved[k] === "boolean") (state[k] as boolean) = saved[k] as boolean;
  }
  return state;
}

export function setChrome(patch: Partial<Chrome>) {
  const cur = read();
  const next = { ...cur, ...patch };
  if (PERSISTED.every((k) => next[k] === cur[k]) && next.sheet === cur.sheet && next.doc === cur.doc) return;
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, next[k]]))));
  } catch {
    // storage blocked: the choice lasts for this page
  }
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

const DESKTOP = "(min-width: 768px)";
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

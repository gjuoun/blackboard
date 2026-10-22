"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { closeTab, parseTabs, SCRATCHPAD_TAB, serializeTabs, TABS_KEY, type Tab } from "@/lib/tabs";

// Open tabs live in localStorage, read through one cached snapshot so every subscriber sees the
// same array (useSyncExternalStore needs a stable value between changes).
const EMPTY: Tab[] = [];
let cache: Tab[] | null = null;
const listeners = new Set<() => void>();

function read(): Tab[] {
  if (cache === null) cache = parseTabs(localStorage.getItem(TABS_KEY));
  return cache;
}

export function getTabs(): Tab[] {
  return read();
}

export function setTabs(tabs: Tab[]) {
  if (tabs === cache) return;
  cache = tabs;
  try {
    localStorage.setItem(TABS_KEY, serializeTabs(tabs));
  } catch {
    // storage full or blocked: the strip still works for this page
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another browser tab changed the list.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== TABS_KEY) return;
    cache = null;
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}

const useTabs = () => useSyncExternalStore(subscribe, read, () => EMPTY);

/** The session id in the current URL, or null on Home and other pages. */
export const sessionIdOf = (pathname: string) => /^\/s\/([a-z0-9]{1,32})\/?$/.exec(pathname)?.[1] ?? null;

// Inline SVG icons (lucide outlines, stroke = currentColor) — text glyphs like ⌂ ← →
// render in whatever font the platform picks and never align; SVGs always do.
const icon = (path: string) => (
  <svg className="tab-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={path} />
  </svg>
);
const ICONS = {
  back: "M19 12H5 M12 19l-7-7 7-7",
  forward: "M5 12h14 M12 5l7 7-7 7",
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  pen: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  close: "M18 6 6 18 M6 6l12 12",
} as const;

/**
 * Across the top of every page: back / forward, a pinned Home tab, then one tab per opened doc.
 * A doc page adds its own tab (RegisterTab); × or a middle click closes one.
 */
export function TabStrip() {
  const tabs = useTabs();
  const pathname = usePathname();
  const router = useRouter();
  const active = sessionIdOf(pathname);

  const close = (id: string) => {
    const { tabs: rest, next } = closeTab(getTabs(), id, active);
    setTabs(rest);
    if (id === active) router.push(next ? `/s/${next}` : "/");
  };

  return (
    <nav className="tab-strip" data-testid="tab-strip" aria-label="Open documents">
      <button type="button" className="tab-nav" data-testid="tab-back" aria-label="Back" title="Back" onClick={() => history.back()}>
        {icon(ICONS.back)}
      </button>
      <button type="button" className="tab-nav" data-testid="tab-forward" aria-label="Forward" title="Forward" onClick={() => history.forward()}>
        {icon(ICONS.forward)}
      </button>
      <Link href="/" className={`tab tab-home${pathname === "/" ? " is-active" : ""}`} data-testid="tab-home" aria-label="Home" title="Home" aria-current={pathname === "/" ? "page" : undefined}>
        {icon(ICONS.home)}
      </Link>
      {tabs.length > 0 ? <span className="tab-sep" aria-hidden /> : null}
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab${t.id === active ? " is-active" : ""}`}
          data-testid="tab"
          data-id={t.id}
          data-kind={t.id === SCRATCHPAD_TAB ? "scratchpad" : "doc"}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            close(t.id);
          }}
        >
          <Link href={`/s/${t.id}`} className="tab-link" title={t.path ?? t.title} aria-current={t.id === active ? "page" : undefined}>
            <span className="tab-icon" data-testid="tab-icon">
              {icon(t.id === SCRATCHPAD_TAB ? ICONS.pen : ICONS.doc)}
            </span>
            <span className="tab-title">{t.title}</span>
          </Link>
          <button type="button" className="tab-close" data-testid="tab-close" aria-label={`Close ${t.title}`} title="Close" onClick={() => close(t.id)}>
            {icon(ICONS.close)}
          </button>
        </div>
      ))}
    </nav>
  );
}

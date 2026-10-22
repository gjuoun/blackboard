/**
 * The tab strip's model, kept pure so it can be tested without a browser. Home is always there
 * and is not stored; every other tab is one session.
 */
export type Tab = { id: string; title: string; path?: string };

export const TABS_KEY = "bb-tabs";
/** Same as the server's SCRATCHPAD_ID; repeated here so the browser bundle needs no server code. */
export const SCRATCHPAD_TAB = "scratchpad";
export const MAX_TABS = 20;
const ID = /^[a-z0-9]{1,32}$/;

/** Add a tab at the end, or update its title/path in place. Same array back when nothing changed. */
export function openTab(tabs: Tab[], tab: Tab): Tab[] {
  const i = tabs.findIndex((t) => t.id === tab.id);
  if (i >= 0) {
    const cur = tabs[i];
    if (cur.title === tab.title && cur.path === tab.path) return tabs;
    return tabs.map((t, j) => (j === i ? { ...t, ...tab } : t));
  }
  return [...tabs, tab].slice(-MAX_TABS);
}

export function removeTab(tabs: Tab[], id: string): Tab[] {
  return tabs.filter((t) => t.id !== id);
}

/**
 * Close a tab. When it was the active one, the next active tab is its right neighbour, else its
 * left one, else Home (null). Closing a background tab keeps `active`.
 */
export function closeTab(tabs: Tab[], id: string, active: string | null): { tabs: Tab[]; next: string | null } {
  const i = tabs.findIndex((t) => t.id === id);
  const rest = removeTab(tabs, id);
  if (id !== active) return { tabs: rest, next: active };
  const neighbour = tabs[i + 1] ?? tabs[i - 1];
  return { tabs: rest, next: neighbour && neighbour.id !== id ? neighbour.id : null };
}

export function serializeTabs(tabs: Tab[]): string {
  return JSON.stringify(tabs);
}

/** Tabs from storage; anything malformed, duplicated or with an odd id is dropped. */
export function parseTabs(raw: string | null): Tab[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Tab[] = [];
  for (const v of data) {
    if (!v || typeof v !== "object") continue;
    const { id, title, path } = v as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || typeof title !== "string" || out.some((t) => t.id === id)) continue;
    out.push(typeof path === "string" ? { id, title, path } : { id, title });
  }
  return out.slice(-MAX_TABS);
}

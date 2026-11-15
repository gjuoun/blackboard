"use client";

import { useSyncExternalStore } from "react";
import { parseTabs, serializeTabs, TABS_KEY, type Tab } from "@/lib/tabs";

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

export const useTabs = () => useSyncExternalStore(subscribe, read, () => EMPTY);

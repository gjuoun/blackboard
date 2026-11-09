"use client";

import { useSyncExternalStore } from "react";
import type { ReadingFilter, WorkspaceCounts } from "@/lib/reading-model";

/** Everything the merged top bar needs from the workspace page while it is mounted. */
export type WorkspaceBar = {
  query: string;
  onQuery: (value: string) => void;
  repo: string;
  repos: string[];
  onRepo: (value: string) => void;
  filter: ReadingFilter;
  onFilter: (value: "all" | "unread" | "reading") => void;
  counts: WorkspaceCounts;
  pending: number;
  onMarkAll: () => void;
};

// The workspace page publishes its bar props here so the top bar (in the root layout, above the
// page) can fold them into the single desktop row — the tabs-store pattern: one cached snapshot,
// set listeners on write.
let bar: WorkspaceBar | null = null;
const listeners = new Set<() => void>();

export function setWorkspaceBar(next: WorkspaceBar | null) {
  bar = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The bar props the mounted workspace page last published, or null anywhere else (and on SSR). */
export const useWorkspaceBar = () => useSyncExternalStore(subscribe, () => bar, () => null);

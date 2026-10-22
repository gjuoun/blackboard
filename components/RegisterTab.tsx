"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { openTab, removeTab } from "@/lib/tabs";
import { setChrome } from "./chrome";
import { getTabs, sessionIdOf, setTabs } from "./TopBar";

/** Rendered by a doc page: opening any /s/<id> (from Home, the CLI or a typed URL) adds its tab and tells the top bar about the doc. */
export function RegisterTab({ id, title, path, readable, hasToc }: { id: string; title: string; path: string; readable: boolean; hasToc: boolean }) {
  useEffect(() => {
    setTabs(openTab(getTabs(), { id, title, path }));
  }, [id, title, path]);
  useEffect(() => {
    setChrome({ doc: { id, path, readable, hasToc, open: 0 }, sheet: null });
    return () => setChrome({ doc: null, sheet: null });
  }, [id, path, readable, hasToc]);
  return null;
}

/** Rendered on a session's 404: the session is gone, so its tab goes too. */
export function ForgetTab() {
  const pathname = usePathname();
  useEffect(() => {
    const id = sessionIdOf(pathname);
    if (id) setTabs(removeTab(getTabs(), id));
  }, [pathname]);
  return null;
}

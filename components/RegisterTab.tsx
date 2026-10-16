"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { openTab, removeTab } from "@/lib/tabs";
import { getTabs, sessionIdOf, setTabs } from "./TabStrip";

/** Rendered by a doc page: opening any /s/<id> (from Home, the CLI or a typed URL) adds its tab. */
export function RegisterTab({ id, title, path }: { id: string; title: string; path: string }) {
  useEffect(() => {
    setTabs(openTab(getTabs(), { id, title, path }));
  }, [id, title, path]);
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

"use client";

import { useEffect, useRef, useState } from "react";
import type { TocEntry } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { useVirtualDocContext, type VirtualDocHandle } from "./useVirtualDoc";
import { useVirtualList } from "./useVirtualList";

/** How far below the top bar a heading counts as "reached". */
const OFFSET = 72;

/** The id of the last heading that has scrolled up to the top bar, or the first one before any has. */
function currentId(toc: TocEntry[]): string | null {
  let cur = toc[0]?.id ?? null;
  for (const t of toc) {
    const el = document.getElementById(t.id);
    if (el && el.getBoundingClientRect().top <= OFFSET) cur = t.id;
  }
  // At the very bottom the last sections can never reach the top, so the last heading wins.
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = toc.at(-1)?.id ?? cur;
  return cur;
}

/** The virtualized twin of `currentId`: heading positions come from the virtualizer's offsets
 *  (measured where visited, estimated elsewhere), so the highlight follows the reader through
 *  sections whose headings are not mounted. */
function currentIdVirtual(toc: TocEntry[], virt: VirtualDocHandle): string | null {
  let cur = toc[0]?.id ?? null;
  const docTop = virt.docTop();
  for (const t of toc) {
    const top = virt.topForId(t.id);
    if (top != null && docTop + top - scrollY <= OFFSET) cur = t.id;
  }
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = toc.at(-1)?.id ?? cur;
  return cur;
}

/** Section list for the left panel (and the phone's Contents sheet); highlights the section being read. */
export function Toc({ toc }: { toc: TocEntry[] }) {
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement>(null);
  const virt = useVirtualDocContext();
  // A doc can carry thousands of headings; past the threshold the list mounts only the rows its
  // own pane can see. Below it, every row mounts exactly as before and nothing is written to the DOM.
  const list = useVirtualList({ listRef, count: toc.length });
  // Destructured for the reveal effect: the list object is rebuilt whenever the window moves,
  // but only these two values should re-run it.
  const { enabled: listEnabled, reveal } = list;

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(virt.handle.enabled() ? currentIdVirtual(toc, virt.handle) : currentId(toc)));
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [toc, virt]);

  // Keep the highlighted entry visible when the list itself scrolls (long docs). Windowed, the
  // row may be unmounted, so the list is scrolled by position instead of scrollIntoView — and
  // without touching focus, which belongs to whatever the reader is using.
  useEffect(() => {
    if (listEnabled) {
      const i = toc.findIndex((t) => t.id === active);
      if (i >= 0) reveal(i);
      return;
    }
    listRef.current?.querySelector<HTMLElement>("[aria-current=location]")?.scrollIntoView({ block: "nearest" });
  }, [active, listEnabled, reveal, toc]);

  if (toc.length === 0) return null;

  const range = list.enabled ? list.range : null;
  const rows: { entry: TocEntry; index: number }[] = [];
  if (range) for (let i = range.first; i <= range.last && i < toc.length; i++) rows.push({ entry: toc[i], index: i });
  else for (let i = 0; i < toc.length; i++) rows.push({ entry: toc[i], index: i });

  return (
    <nav data-testid="toc" aria-label="On this page" className="text-[13.5px]">
      <h2 className="text-muted-foreground mb-2 px-2 text-xs font-semibold">Contents</h2>
      <ul ref={listRef} className="m-0 list-none p-0" {...(list.enabled ? { "data-vlist": "on" } : {})}>
        {list.enabled && list.top > 0 ? <li aria-hidden data-vlist-spacer="top" style={{ height: `${list.top}px` }} /> : null}
        {rows.map(({ entry: t, index }) => {
          const on = t.id === active;
          return (
            <li key={t.id} {...(list.enabled ? { "data-vlist-row": index } : {})}>
              <a
                href={`#${t.id}`}
                data-active={on}
                aria-current={on ? "location" : undefined}
                onClick={(e) => {
                  setActive(t.id);
                  // A virtualized doc's target heading may be unmounted: the native anchor jump
                  // has nothing to find, so the virtualizer lands it and the hash is set by hand.
                  if (virt.handle.enabled() && virt.handle.scrollToId(t.id)) {
                    e.preventDefault();
                    history.pushState(null, "", `#${t.id}`);
                  }
                }}
                className={cn("text-muted-foreground hover:bg-accent hover:text-foreground block rounded-lg px-2 py-1 leading-snug", t.depth <= 1 && "font-semibold", on && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary font-semibold")}
                style={{ paddingLeft: `${8 + Math.max(0, t.depth - 2) * 12}px` }}
              >
                {t.text}
              </a>
            </li>
          );
        })}
        {list.enabled && list.bottom > 0 ? <li aria-hidden data-vlist-spacer="bottom" style={{ height: `${list.bottom}px` }} /> : null}
      </ul>
    </nav>
  );
}

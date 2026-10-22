"use client";

import { useEffect, useRef, useState } from "react";
import type { TocEntry } from "@/lib/markdown";
import { cn } from "@/lib/utils";

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

/** Section list for the left panel (and the phone's Contents sheet); highlights the section being read. */
export function Toc({ toc }: { toc: TocEntry[] }) {
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentId(toc)));
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [toc]);

  // Keep the highlighted entry visible when the list itself scrolls (long docs).
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-current=location]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (toc.length === 0) return null;
  return (
    <nav data-testid="toc" aria-label="On this page" className="text-[13.5px]">
      <h2 className="text-muted-foreground mb-2 px-2 text-xs font-semibold">Contents</h2>
      <ul ref={listRef} className="m-0 list-none p-0">
        {toc.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.id}>
              <a
                href={`#${t.id}`}
                data-active={on}
                aria-current={on ? "location" : undefined}
                onClick={() => setActive(t.id)}
                className={cn("text-muted-foreground hover:bg-accent hover:text-foreground block rounded-lg px-2 py-1 leading-snug", t.depth <= 1 && "font-semibold", on && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary font-semibold")}
                style={{ paddingLeft: `${8 + Math.max(0, t.depth - 2) * 12}px` }}
              >
                {t.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

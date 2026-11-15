"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, ORDER, TOP_SECTIONS } from "./catalog-data";

/**
 * The catalogue's navigation: a sticky column from 1024px, one jump select below it. Both read the
 * same section list, so they cannot offer an anchor the page does not have. The active section is the
 * last one whose top has passed the upper third of the screen.
 */
function useActive(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.33;
      let current = els[0]?.id ?? "";
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);
  return active;
}

const item = (on: boolean) =>
  on
    ? "block rounded-md bg-muted px-2 py-1 text-[13px] font-semibold text-foreground"
    : "block rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground";

export function Rail() {
  const active = useActive(ORDER);
  const category = CATEGORIES.find((c) => c.components.some((k) => k.id === active))?.id ?? "";

  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm lg:hidden">
        <span className="text-muted-foreground">Jump to</span>
        <select
          aria-label="Jump to a section"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) window.location.hash = e.target.value;
          }}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value="">Choose a section</option>
          {TOP_SECTIONS.map((s) => (
            <option key={s.id} value={"#" + s.id}>
              {s.title}
            </option>
          ))}
          {CATEGORIES.map((c) => (
            <optgroup key={c.id} label={c.title}>
              <option value={"#cat-" + c.id}>{c.title}</option>
              {c.components.map((k) => (
                <option key={k.id} value={"#" + k.id}>
                  {"\u00a0\u00a0" + k.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <aside className="hidden lg:sticky lg:top-[calc(var(--bar-h)+16px)] lg:block lg:max-h-[calc(100vh-var(--bar-h)-2rem)] lg:w-[13rem] lg:shrink-0 lg:self-start lg:overflow-y-auto lg:pb-16">
        <nav aria-label="Catalogue sections" className="flex flex-col gap-3 text-sm">
          {TOP_SECTIONS.map((s) => (
            <a key={s.id} href={"#" + s.id} aria-current={active === s.id ? "location" : undefined} className={item(active === s.id)}>
              {s.title}
            </a>
          ))}
          {CATEGORIES.map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5">
              <a
                href={"#cat-" + c.id}
                aria-current={category === c.id ? "location" : undefined}
                className={item(category === c.id)}
              >
                {c.title}
              </a>
              <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                {c.components.map((k) => (
                  <li key={k.id}>
                    <a href={"#" + k.id} aria-current={active === k.id ? "location" : undefined} className={item(active === k.id)}>
                      {k.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
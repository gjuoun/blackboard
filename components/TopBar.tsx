"use client";

import { ArrowLeft, Copy, Home, ListTree, MessageSquare, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { closeTab, moveTab, parseTabs, SCRATCHPAD_TAB, serializeTabs, TABS_KEY, type Tab } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { setChrome, togglePanel, useChrome, useIsDesktop } from "./chrome";

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

/**
 * The one bar across the top of every page: Back to list, one tab per opened doc, then (on a doc)
 * Contents and Comments toggles and a ⋯ menu for everything else. On a phone only the current
 * title shows in the bar, as wide as it can be; the other tabs move into the ⋯ menu.
 */
export function TopBar() {
  const tabs = useTabs();
  const pathname = usePathname();
  const router = useRouter();
  const chrome = useChrome();
  const desktop = useIsDesktop();
  const active = sessionIdOf(pathname);
  const doc = chrome.doc && chrome.doc.id === active ? chrome.doc : null;
  const onHome = pathname === "/";
  const current = tabs.find((t) => t.id === active);

  // Drag a tab to reorder: `drag.id` is the tab in hand, `mark` the edge it would land on.
  const [drag, setDrag] = useState<{ id: string; mark: { id: string; side: "before" | "after" } | null } | null>(null);
  const dropBefore = (mark: { id: string; side: "before" | "after" }) => (mark.side === "before" ? mark.id : (tabs[tabs.findIndex((t) => t.id === mark.id) + 1]?.id ?? null));
  const endDrag = () => setDrag(null);

  const close = (id: string) => {
    const { tabs: rest, next } = closeTab(getTabs(), id, active);
    setTabs(rest);
    if (id === active) router.push(next ? `/s/${next}` : "/");
  };
  const closeOthers = () => {
    const keep = tabs.filter((t) => t.id === active);
    setTabs(keep);
  };
  // "Wrap code blocks" is a reading option for the whole page, so it rides on <html>.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-wrap-code", chrome.wrapCode);
  }, [chrome.wrapCode]);
  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <header className="bg-background/90 border-border sticky top-0 z-30 flex h-[var(--bar-h)] items-center gap-1.5 border-b px-2 backdrop-blur md:px-3" data-testid="tab-strip">
      <Link href="/" className="hidden items-center gap-2 px-1.5 text-[15px] font-bold md:flex" aria-label="Blackboard home">
        <span className="bg-primary size-2.5 rotate-45 rounded-[2px]" />
        Blackboard
      </Link>

      <Button asChild={!onHome} variant="ghost" size="sm" disabled={onHome} className="shrink-0 px-2 md:hidden" data-testid="tab-back">
        {onHome ? (
          <span aria-label="Back to list">
            <ArrowLeft />
          </span>
        ) : (
          <Link href="/" aria-label="Back to list" title="Back to list">
            <ArrowLeft />
          </Link>
        )}
      </Button>
      {/* Desktop tabs: the pinned Home tab is the way back to the list */}
      <nav
        className="scrollbar-none hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex"
        aria-label="Open documents"
        onDragOver={(e) => drag && e.preventDefault()}
        onDrop={(e) => {
          // A drop on the empty strip after the last tab sends the tab to the end.
          if (e.target !== e.currentTarget || !drag) return;
          e.preventDefault();
          setTabs(moveTab(getTabs(), drag.id, null));
          endDrag();
        }}
      >
        <Link
          href="/"
          data-testid="tab-home"
          aria-current={onHome ? "page" : undefined}
          title="Home"
          className={cn("text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center rounded-lg border border-transparent px-3 text-sm", onHome && "bg-card text-foreground border-border shadow-xs")}
        >
          <Home className="size-4" />
        </Link>
        {tabs.map((t) => (
          <div
            key={t.id}
            data-testid="tab"
            data-id={t.id}
            data-kind={t.id === SCRATCHPAD_TAB ? "scratchpad" : "doc"}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", t.id);
              setDrag({ id: t.id, mark: null });
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
              if (drag.mark?.id !== t.id || drag.mark.side !== side) setDrag({ ...drag, mark: { id: t.id, side } });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag?.mark) setTabs(moveTab(getTabs(), drag.id, dropBefore(drag.mark)));
              endDrag();
            }}
            onDragEnd={endDrag}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              close(t.id);
            }}
            className={cn("group text-muted-foreground hover:text-foreground relative flex h-8 max-w-56 shrink-0 items-center rounded-lg border border-transparent text-sm", t.id === active && "bg-card text-foreground border-border font-medium shadow-xs", drag?.id === t.id && "opacity-40", drag?.mark?.id === t.id && drag.id !== t.id && (drag.mark.side === "before" ? "before:bg-primary before:absolute before:-left-1 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full" : "after:bg-primary after:absolute after:-right-1 after:top-1 after:bottom-1 after:w-0.5 after:rounded-full"))}
          >
            <Link href={`/s/${t.id}`} title={t.path ?? t.title} aria-current={t.id === active ? "page" : undefined} className="min-w-0 truncate py-1 pr-1 pl-3">
              {t.title}
            </Link>
            <button type="button" data-testid="tab-close" aria-label={`Close ${t.title}`} title="Close" onClick={() => close(t.id)} className="text-muted-foreground hover:bg-accent hover:text-foreground mr-1 grid size-5 shrink-0 place-items-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>

      {/* Phone: just the current title, as wide as the bar allows */}
      <div className="line-clamp-2 min-w-0 flex-1 px-1 text-sm leading-tight font-semibold md:hidden" data-testid="bar-title">
        {onHome ? "Blackboard" : (current?.title ?? "Document")}
      </div>

      {doc?.readable ? (
        <>
          <span className="bg-border hidden h-5 w-px shrink-0 md:block" aria-hidden />
          {doc.hasToc ? (
            <Button variant="ghost" size="icon-sm" aria-pressed={desktop ? chrome.tocOpen : chrome.sheet === "toc"} aria-label="Contents" title="Contents" data-testid="toggle-toc" onClick={() => togglePanel("toc", desktop)} className={cn("shrink-0", (desktop ? chrome.tocOpen : chrome.sheet === "toc") && "bg-card border-border border")}>
              <ListTree />
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" aria-pressed={desktop ? chrome.cmOpen : chrome.sheet === "cm"} aria-label="Comments" title="Comments" data-testid="toggle-comments" onClick={() => togglePanel("cm", desktop)} className={cn("shrink-0 gap-1.5 px-2", (desktop ? chrome.cmOpen : chrome.sheet === "cm") && "bg-card border-border border")}>
            <MessageSquare />
            {doc.open > 0 ? <span className="bg-primary-soft text-primary rounded-full px-1.5 text-xs leading-[18px] font-semibold">{doc.open}</span> : null}
          </Button>
        </>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More" title="More" data-testid="bar-menu" className="shrink-0">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {doc ? (
            <>
              <DropdownMenuLabel>This document</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => copy(doc.path)}>
                <Copy /> Copy file path
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={chrome.showResolved} onCheckedChange={(v) => setChrome({ showResolved: v })}>
                Show resolved comments
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={chrome.wrapCode} onCheckedChange={(v) => setChrome({ wrapCode: v })}>
                Wrap code blocks
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {/* Phone only: the tabs the bar has no room for */}
          <div className="md:hidden">
            <DropdownMenuLabel>Tabs</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/">
                <Home /> Home
              </Link>
            </DropdownMenuItem>
            {tabs.map((t) => (
              <DropdownMenuItem key={t.id} asChild>
                <Link href={`/s/${t.id}`} className={cn(t.id === active && "font-semibold")}>
                  <span className="truncate">{t.title}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuLabel>Manage tabs</DropdownMenuLabel>
          <DropdownMenuItem disabled={!current} onSelect={() => current && close(current.id)}>
            Close this tab
          </DropdownMenuItem>
          <DropdownMenuItem disabled={tabs.length < 2 || !current} onSelect={closeOthers}>
            Close other tabs
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => history.back()}>Back</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => history.forward()}>Forward</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

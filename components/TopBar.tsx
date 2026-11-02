"use client";

import { ChevronDown, ListTree, MessageSquare, MoreHorizontal } from "lucide-react";

/** The timeline icon: a vertical line with a filled dot at each end, same stroke grammar as the other icons. */
function TimelineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="5" r="2.2" fill="currentColor" />
      <circle cx="12" cy="19" r="2.2" fill="currentColor" />
      <path d="M12 7.5v9" />
    </svg>
  );
}
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { closeTab } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { setChrome, togglePanel, useChrome, useIsDesktop } from "./chrome";
import { ReadingSettings } from "./ReadingSettings";
import { TabStrip } from "./TabStrip";
import { getTabs, setTabs, useTabs } from "./tabs-store";

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

  // Phone bottom bar: collapsed (a pill) or expanded (the icon row). The default look is CSS; this is only the tap state.
  const [expanded, setExpanded] = useState(false);

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
  const docToggles = (
    <>
      <DropdownMenuCheckboxItem checked={chrome.showResolved} onCheckedChange={(v) => setChrome({ showResolved: v })}>
        Show resolved comments
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem checked={chrome.wrapCode} onCheckedChange={(v) => setChrome({ wrapCode: v })}>
        Wrap code blocks
      </DropdownMenuCheckboxItem>
    </>
  );

  return (
    <header className="bg-background/90 border-border sticky top-0 z-30 flex h-[var(--bar-h)] items-center gap-1.5 border-b px-2 max-md:contents md:px-3 md:backdrop-blur" data-testid="tab-strip">
      <Link href="/" className="hidden items-center gap-2 px-1.5 text-[15px] font-bold md:flex" aria-label="Blackboard home">
        <span className="bg-primary size-2.5 rotate-45 rounded-[2px]" />
        Blackboard
      </Link>

      {/* Desktop tabs: the pinned Home tab is the way back to the list */}
      <TabStrip tabs={tabs} active={active} onHome={onHome} onClose={close} />

      {/* Phone: the actions leave the top bar for a fixed bottom box. It is a pill while collapsed and a full-width
          row once expanded (the expanded state is user interaction; the collapsed look is CSS keyed on data-expanded).
          The box is fixed, so it is not contained by the header, which is why the header drops its backdrop filter
          below 768px. From 768px the wrapper and its row are `display: contents` and the desktop bar lays out as before. */}
      <div
        data-testid="bar-actions"
        data-expanded={expanded}
        className="md:contents max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex max-md:items-center max-md:gap-1 max-md:bg-background/95 max-md:border-border max-md:data-[expanded=true]:border-t max-md:px-2 max-md:pt-1.5 max-md:pb-[calc(0.375rem+env(safe-area-inset-bottom))] max-md:data-[expanded=false]:right-auto max-md:data-[expanded=false]:left-1/2 max-md:data-[expanded=false]:-translate-x-1/2 max-md:data-[expanded=false]:bottom-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:data-[expanded=false]:rounded-full max-md:data-[expanded=false]:border max-md:data-[expanded=false]:px-1 max-md:data-[expanded=false]:pt-0 max-md:data-[expanded=false]:pb-0 max-md:data-[expanded=false]:shadow-md"
      >
        <div data-testid="bar-tools" data-expanded={expanded} className="md:contents max-md:flex max-md:flex-1 max-md:items-center max-md:justify-around max-md:gap-1 max-md:data-[expanded=false]:hidden">
        {/* The timeline is first in the icon group and shows on every page that has a stream, a stream included. */}
        {doc?.streamHref ? (
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                aria-label="Streaming document timeline"
                title="流式文档 · 时间线"
                data-testid="open-timeline"
                data-active={doc.kind === "stream"}
                aria-current={doc.kind === "stream" ? "page" : undefined}
                className={cn("shrink-0", doc.kind === "stream" ? "bg-primary-soft text-primary border-primary border" : "")}
              >
                <a href={doc.streamHref}>
                  <TimelineIcon />
                </a>
              </Button>
        ) : null}
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

        {/* Reading settings live in the bar at every width: one icon keeps the palette and font
            controls one click away on a phone without a duplicate entry in the ⋯ menu. */}
        <ReadingSettings />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More" title="More" data-testid="bar-menu" className={cn("shrink-0", !doc && "max-md:hidden")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
          {/* Phone: the document title heads the menu, and the menu holds only what a phone reader needs.
              Tabs are a desktop feature (the strip renders from 768px), so they are not offered here. */}
          <div className="md:hidden">
            {doc ? (
              <>
                <DropdownMenuLabel className="text-foreground line-clamp-2 py-1.5 text-sm leading-snug font-semibold whitespace-normal" data-testid="menu-title">
                  {current?.title ?? "Document"}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/">← Sessions</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copy(window.location.href)}>Copy link</DropdownMenuItem>
                <DropdownMenuSeparator />
                {docToggles}
              </>
            ) : null}
          </div>
          {/* Desktop: the menu as it was. */}
          <div className="max-md:hidden">
            {doc ? (
              <>
                <DropdownMenuLabel>This document</DropdownMenuLabel>
                <DropdownMenuItem inset onSelect={() => copy(doc.path)}>
                  Copy file path
                </DropdownMenuItem>
                {docToggles}
                <DropdownMenuSeparator />
              </>
            ) : null}
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
          </div>
        </DropdownMenuContent>
        </DropdownMenu>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="bar-handle"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide reading tools" : "Show reading tools"}
          title={expanded ? "Hide reading tools" : "Show reading tools"}
          onClick={() => setExpanded((v) => !v)}
          className={cn("md:hidden shrink-0", !expanded && "h-8 w-14 rounded-full")}
        >
          {expanded ? <ChevronDown /> : <span className="bg-muted-foreground/50 h-1 w-8 rounded-full" aria-hidden />}
        </Button>
      </div>
    </header>
  );
}

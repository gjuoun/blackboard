import { LEFT_LABELS, type LeftTab } from "@/lib/left-rail";

/**
 * The left rail's tab strip. Each tab is a plain link (`?left=<tab>`), so switching needs no client
 * state. The pane under it is passed in by the page.
 */
export function LeftRail({ tabs, active, hrefFor }: { tabs: readonly LeftTab[]; active: LeftTab; hrefFor: (tab: LeftTab) => string }) {
  if (tabs.length === 0) return null;
  return (
    <div className="rail-tabs" role="tablist" aria-label="Navigation" data-testid="left-tabs">
      {tabs.map((t) => (
        <a key={t} role="tab" className="rail-tab" href={hrefFor(t)} aria-selected={active === t} data-testid={`left-tab-${t}`}>
          {LEFT_LABELS[t]}
        </a>
      ))}
    </div>
  );
}

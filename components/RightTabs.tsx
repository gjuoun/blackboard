import type { RightTab } from "@/lib/prefs";

/**
 * Comments / File tabs at the top of the one shared right column. They are plain links: the
 * selected pane is a server query choice, so a tab switch needs no client state.
 */
export function RightTabs({
  active,
  commentHref,
  open,
  fileHref,
}: {
  active: RightTab;
  commentHref: string;
  open: number;
  /** The File tab, when the document has source to show (every registered file does). */
  fileHref?: string;
}) {
  return (
    <div className="rail-tabs" role="tablist" aria-label="Right panel" data-testid="right-tabs">
      <a role="tab" className="rail-tab" href={commentHref} aria-selected={active === "comments"} data-testid="right-tab-comments">
        Comments <span className="count">{open}</span>
      </a>
      {fileHref ? (
        <a role="tab" className="rail-tab" href={fileHref} aria-selected={active === "file"} data-testid="right-tab-file">
          File
        </a>
      ) : null}
    </div>
  );
}

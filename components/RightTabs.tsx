import type { RightTab } from "@/lib/prefs";

/**
 * Comments / Local PR tabs at the top of the one shared right column. They are plain links: the
 * selected pane is a server query choice, so a tab switch needs no client state and no diff work.
 */
export function RightTabs({
  active,
  commentHref,
  prHref,
  open,
  additions,
  deletions,
  showPr = true,
  fileHref,
}: {
  active: RightTab;
  commentHref: string;
  prHref: string;
  open: number;
  additions: number;
  deletions: number;
  showPr?: boolean;
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
      {showPr ? (
        <a role="tab" className="rail-tab" href={prHref} aria-selected={active === "pr"} data-testid="right-tab-pr">
          Local PR{" "}
          <span className="pr-num">
            <b className="na">+{additions}</b> <b className="nd">−{deletions}</b>
          </span>
        </a>
      ) : null}
    </div>
  );
}

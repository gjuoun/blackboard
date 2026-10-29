import { GitBranch, GitCompareArrows } from "lucide-react";
import type { DiffSnapshot } from "@/lib/diff-index";
import { fileHref, prAllHref, prListHref, type SelectedFile } from "@/lib/file-refs";
import { renderFileDiff, renderSnippet } from "@/lib/snippet";
import { DiffFileList } from "./DiffFileList";

/**
 * The Local PR pane: server-rendered HTML for the file list, a selected range snippet, or a whole
 * file diff. No client component is involved, so the diff and its line colours exist in the first
 * response and never depend on a browser-side highlighter.
 *
 * `refs` is the document's own file-link result, already computed by the markdown pass: when it
 * names any changed file the list starts as that intersection. `showAll` is the `?all=1` server
 * choice that puts every changed file back. The summary always reports the whole snapshot.
 */
export function DiffPanel({
  index,
  selected,
  refs = [],
  showAll = false,
}: {
  index: DiffSnapshot | null;
  selected: SelectedFile | null;
  refs?: readonly string[];
  showAll?: boolean;
}) {
  if (!index) {
    return (
      <div className="diff-panel" data-testid="diff-panel">
        <p className="diff-empty" data-testid="diff-empty">Local PR is available for documents inside a git repository.</p>
      </div>
    );
  }
  const totals = index.totals;
  const range = selected && selected.start !== null ? { start: selected.start, end: selected.end ?? selected.start } : null;
  const snippet = selected && range ? renderSnippet(index, selected.path, range) : null;
  const whole = selected && !range ? renderFileDiff(index, selected.path) : null;

  // A document with no changed-file reference keeps the whole list. Only snapshot files can match,
  // because `refs` was collected from this same index.
  const referenced = new Set(refs);
  const filtered = !showAll && referenced.size > 0;
  const files = filtered ? index.files.filter((file) => referenced.has(file.path)) : index.files;
  const showAllHref = !showAll && files.length < index.files.length ? prAllHref() : null;

  return (
    <div className="diff-panel" data-testid="diff-panel">
      <div className="pr-head">
        <h2>
          <GitCompareArrows aria-hidden />
          Local PR
        </h2>
        {range ? (
          <span className="link-tag" data-testid="snippet-link-tag">
            from link · L{range.start}-L{range.end}
          </span>
        ) : null}
      </div>
      <span className="pr-base" data-testid="diff-base">
        <GitBranch aria-hidden />
        base {index.baseRef} @ {index.baseSha} → worktree
      </span>
      <div className="pr-sum" data-testid="diff-summary">
        <b className="na">+{totals.additions}</b> <b className="nd">−{totals.deletions}</b> · {totals.files} files · tracked + staged + untracked
      </div>

      {snippet ? (
        <div data-testid="diff-snippet">
          <a className="pr-back" href={prListHref()} data-testid="diff-back">
            ‹ {totals.files} files
          </a>
          <div className="snip-path" data-testid="snippet-path">
            <span className="fn" title={snippet.path}>{snippet.path}</span>
            <span className="snip-range" data-testid="snippet-range">L{snippet.range.start}-L{snippet.range.end}</span>
            <span className="snip-stat nums" data-testid="snippet-stat">
              <b className="na">+{snippet.additions}</b> <b className="nd">−{snippet.deletions}</b> in range
            </span>
          </div>
          <div dangerouslySetInnerHTML={{ __html: snippet.html }} />
          <div className="snip-actions">
            <a href={fileHref(snippet.path, null)} data-testid="snippet-whole-file">entire file diff ›</a>
          </div>
        </div>
      ) : whole ? (
        <div data-testid="diff-file">
          <a className="pr-back" href={prListHref()} data-testid="diff-back">
            ‹ {totals.files} files
          </a>
          <div className="snip-path" data-testid="file-diff-path">
            <span className="fn" title={whole.path}>{whole.path}</span>
            <span className="snip-stat nums">
              <b className="na">+{whole.additions}</b> <b className="nd">−{whole.deletions}</b>
            </span>
          </div>
          <div dangerouslySetInnerHTML={{ __html: whole.html }} />
        </div>
      ) : (
        <DiffFileList index={index} selected={null} files={files} showAllHref={showAllHref} />
      )}
    </div>
  );
}

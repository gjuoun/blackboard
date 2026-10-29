import type { DiffFile, DiffSnapshot } from "@/lib/diff-index";
import { fileHref } from "@/lib/file-refs";

const BADGE: Record<string, { letter: string; cls: string }> = {
  modified: { letter: "M", cls: "M" },
  added: { letter: "A", cls: "A" },
  untracked: { letter: "A", cls: "A" },
  deleted: { letter: "D", cls: "D" },
  renamed: { letter: "R", cls: "R" },
};

/**
 * The changed-file list that fills the Local PR tab. Every row is an ordinary link; the selected
 * file (when a snippet is open) carries aria-current for the primary-soft highlight.
 *
 * `files` is whatever the server decided to show: the snapshot order by default, or the subset the
 * document references. `showAllHref` is set only when that subset is smaller than the snapshot, so
 * the footer is one server-rendered link and no client state sits behind it.
 */
export function DiffFileList({
  index,
  selected,
  files = index.files,
  showAllHref = null,
}: {
  index: DiffSnapshot;
  selected: string | null;
  files?: readonly DiffFile[];
  showAllHref?: string | null;
}) {
  if (files.length === 0) {
    return (
      <p className="diff-empty" data-testid="diff-empty">
        No local changes against {index.baseRef}.
      </p>
    );
  }
  return (
    <>
      <ul className="pr-files" data-testid="diff-file-list">
        {files.map((file) => {
          const parts = file.path.split("/");
          const name = parts.pop() ?? file.path;
          const dir = parts.length > 0 ? parts.join("/") + "/" : "";
          const badge = BADGE[file.status] ?? BADGE.modified;
          const total = file.additions + file.deletions;
          const addPct = total === 0 ? 0 : Math.round((file.additions / total) * 100);
          return (
            <li key={file.path} data-status={file.status} className={file.path === selected ? "sel" : undefined}>
              <a href={fileHref(file.path, null)} data-file={file.path} aria-current={file.path === selected ? "true" : undefined}>
                <span className={"st " + badge.cls} aria-label={file.status}>{badge.letter}</span>
                <span className="pr-path" title={file.path}>
                  <bdi className="pr-dir">{dir}</bdi>
                  <bdi className="pr-name">{name}</bdi>
                </span>
                <span className="nums">
                  {file.additions > 0 ? <b className="na">+{file.additions}</b> : null}
                  {file.deletions > 0 ? <b className="nd">−{file.deletions}</b> : null}
                  {total > 0 ? (
                    <span className="stat" aria-hidden>
                      <i className="sa" style={{ width: addPct + "%" }} />
                      <i className="sd" style={{ width: 100 - addPct + "%" }} />
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {showAllHref ? (
        <a className="pr-all" href={showAllHref} data-testid="diff-show-all">
          show all {index.files.length} files
        </a>
      ) : null}
    </>
  );
}

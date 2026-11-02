import type { ChangedLines } from "@/lib/file-view";

/**
 * The File tab: the raw source, read-only. Each line has a number; lines that differ from HEAD carry a
 * class so the CSS can mark them. No wrap: long lines scroll sideways. The full-window view is the same
 * block with the wider container (the page passes `full`).
 */
export function FileView({ lines, changed, full, backHref, fullHref }: { lines: readonly string[]; changed: ChangedLines; full: boolean; backHref: string; fullHref: string }) {
  const width = String(lines.length).length;
  return (
    <div className="file-view text-[12.5px]" data-testid="file-view" data-full={full ? "1" : "0"}>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <a href={backHref} className="text-primary" data-testid="file-original">原文</a>
        <a href={fullHref} className="text-primary" data-testid="file-fullscreen">全屏</a>
      </div>
      <pre className="file-source m-0 overflow-x-auto font-[var(--font-code)] leading-[1.6]" style={{ whiteSpace: "pre" }}>
        {lines.map((text, i) => {
          const n = i + 1;
          const kind = changed.added.has(n) ? "added" : changed.modified.has(n) ? "modified" : "";
          return (
            <span key={n} className={`file-line ${kind}`} data-line={n} data-changed={kind || undefined}>
              <span className="file-ln text-muted-foreground inline-block select-none pr-3 text-right" style={{ minWidth: `${width + 1}ch` }}>{n}</span>
              {text}
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

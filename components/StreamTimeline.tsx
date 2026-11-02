import { blockTitle } from "@/lib/block-title";
import type { StreamBlock } from "@/lib/stream-doc";

/**
 * The timeline in the left rail: the document's title at the top, then one entry per block, each with
 * its title and `author · time` only. No action label. Each entry links to the block's stable id, never
 * to its display number; `:target` marks the block being read. The title comes from the file's own
 * metadata line, so it is there even when no session registry entry is.
 */
export function StreamTimeline({ blocks, title }: { blocks: readonly StreamBlock[]; title: string }) {
  return (
    <div>
      {title ? (
        <h2 className="stream-title m-0 border-b border-border px-3 py-3 text-[13px] font-semibold text-foreground" data-testid="stream-title">
          {title}
        </h2>
      ) : null}
      <ol className="stream-timeline m-0 list-none p-3 text-[13px]" data-testid="stream-timeline">
        {blocks.map((b) => (
          <li key={b.id} className="relative pl-5 pb-3">
            <span aria-hidden className="absolute left-[5px] top-[7px] size-2 rounded-full bg-border" />
            <a href={`#${b.id}`} data-testid="timeline-entry" data-id={b.id} data-n={b.n} className="block text-foreground no-underline hover:text-primary">
              <span className="block font-medium">{blockTitle(b)}</span>
              <span className="text-muted-foreground block text-xs">{b.author} · {b.at}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

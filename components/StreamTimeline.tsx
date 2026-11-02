import type { StreamBlock } from "@/lib/stream-doc";

/**
 * The timeline in the left rail: one entry per block, with its title and `author · time` only. No
 * action label. Each entry links to the block's stable id, never to its display number; `:target` marks the
 * block being read.
 */
export function StreamTimeline({ blocks }: { blocks: readonly StreamBlock[] }) {
  return (
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
  );
}

/** The entry title: the block's first heading, else its n-th position. */
export function blockTitle(b: StreamBlock): string {
  const h = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(b.body);
  return h ? h[1] : `第 ${b.n} 块`;
}

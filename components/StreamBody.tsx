import { ACTION_LABEL, type StreamAction } from "@/lib/stream-doc";
import { StreamFollow } from "./StreamFollow";

/** One timeline node: a block's meta plus the HTML the server rendered from its markdown. */
export type StreamNode = {
  /** The block id (`b-<ulid>`) — the section's anchor and the CLI link's fragment. */
  id: string;
  n: number;
  action: StreamAction;
  author: string;
  /** The display-ready time label ("5 min ago"); computed on the server so SSR and hydration agree. */
  when: string;
  writing: boolean;
  html: string;
};

/**
 * The streamed doc's body: one <section> per exchange, rendered on the server so the whole
 * timeline arrives in the first payload — the virtualizer windows it afterwards exactly as it
 * windows a markdown doc element by element. Each section's id is the block id: the same
 * fragment `blackboard block` prints in its url. A plain component (no "use client") keeps the
 * sections server-rendered; the follow behavior rides along as the StreamFollow leaf.
 */
export function StreamBody({ nodes }: { nodes: StreamNode[] }) {
  const last = nodes[nodes.length - 1];
  return (
    <>
      {nodes.map((b) => (
        <section
          key={b.id}
          id={b.id}
          className="stream-block"
          data-testid={`stream-block-${b.n}`}
          data-block-id={b.id}
          {...(b.writing ? { "data-status": "writing" } : {})}
        >
          <p className="stream-meta">
            {`#${b.n} · ${ACTION_LABEL[b.action]} · ${b.author} · ${b.when}`}
            {b.writing ? <span className="stream-caret">▍ writing</span> : null}
          </p>
          <div className="stream-md" dangerouslySetInnerHTML={{ __html: b.html }} />
          {b.writing ? <p className="stream-tail" aria-hidden="true">▍</p> : null}
        </section>
      ))}
      <StreamFollow tailId={last?.id ?? null} tailWriting={last?.writing ?? false} />
    </>
  );
}

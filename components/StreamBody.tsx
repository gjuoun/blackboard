import { ACTION_LABEL, type StreamAction } from "@/lib/stream-doc";
import { EST_ATTR, PENDING_ATTR } from "@/lib/stream-payload";
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

/** An exchange the first screen skipped: its id and estimated height. `id` is still `b-<ulid>`,
 *  so anchors, the rail and deep links already resolve it before its html arrives. */
export type PendingNode = Omit<StreamNode, "html"> & {
  est: number;
  /** True for a block far outside the viewport: the payload carries only id, estimate and
   *  height, not its meta line. One placeholder costs ~140 B that way against ~290 B with
   *  meta, and at 300 skipped exchanges that difference is the whole payload budget. */
  bare?: boolean;
};

/** A pending section the loader fills in place. The bare form (far from the viewport) keeps the
 *  id, the estimate and the height the layout needs; the near form also shows what is coming.
 *  The loader clears PENDING_ATTR/EST_ATTR and the inline height when the real html lands. */
function Pending({ b }: { b: PendingNode }) {
  if (b.bare) {
    return (
      <section
        id={b.id}
        className="stream-block"
        {...{ [PENDING_ATTR]: "", [EST_ATTR]: b.est }}
        style={{ height: b.est }}
      />
    );
  }
  return (
    <section
      id={b.id}
      className="stream-block"
      {...{ [PENDING_ATTR]: "", [EST_ATTR]: b.est }}
      style={{ height: b.est }}
      data-testid={`stream-block-pending-${b.n}`}
    >
      <p className="stream-meta">
        {`#${b.n} · ${ACTION_LABEL[b.action]} · ${b.author} · ${b.when}`}
        {b.writing ? <span className="stream-caret">▍ writing</span> : null}
      </p>
      <p className="stream-pending" aria-hidden="true">加载中…</p>
    </section>
  );
}

/**
 * The streamed doc's body: one <section> per exchange. Every exchange the window skipped is a
 * `data-pending` placeholder with a real id and estimated height, so the rail, the virtualizer
 * and deep links see a complete timeline while the html comes on demand. Only placeholders near
 * the window carry a meta line: the far ones stay bare to keep the first payload small.
 */
export function StreamBody({ nodes, pending = [] }: { nodes: StreamNode[]; pending?: PendingNode[] }) {
  const byN = new Map<number, StreamNode | PendingNode>();
  for (const b of nodes) byN.set(b.n, b);
  for (const p of pending) byN.set(p.n, p);
  const ordered = [...byN.values()].sort((a, b) => a.n - b.n);
  const last = ordered[ordered.length - 1];
  return (
    <>
      {ordered.map((b) =>
        "html" in b ? (
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
        ) : (
          <Pending key={b.id} b={b} />
        ),
      )}
      <StreamFollow tailId={last?.id ?? null} tailWriting={last?.writing ?? false} />
    </>
  );
}

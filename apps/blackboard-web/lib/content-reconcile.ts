import { parseContentBlocks, blockHash, type BlockSpec } from "./content-blocks";

/**
 * Align a doc's new markdown body with the blocks the last version carried. Order-preserving
 * exact matches keep their id (LCS on hashes); in the gaps, same-kind pairs above the similarity
 * threshold keep the id and count as modified; whatever remains is added or removed. Pure: the
 * caller applies the plan to the store.
 */

export type OldBlock = { id: string; kind: string; text: string; hash: string; rev: number; deletedAt: string | null };

export type ReconcilePlan = {
  /** Fresh blocks still alive, in document order: kept (rev as before) and modified (rev+1). */
  live: { id: string; spec: BlockSpec; n: number; modified: boolean }[];
  /** New blocks with no prior id: caller assigns ids. */
  added: { spec: BlockSpec; n: number }[];
  /** Ids that were live and are gone now (caller sets deleted_at). */
  removed: string[];
};

const tokens = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Multiset Dice over word tokens: 1 identical, 0 unrelated. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const m = new Map<string, number>();
  for (const t of ta) m.set(t, (m.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of tb) {
    const c = m.get(t) ?? 0;
    if (c > 0) {
      common++;
      m.set(t, c - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

const SIM_THRESHOLD = 0.5;

/** Order-preserving exact matches of two hash sequences. */
function lcsMatches(oldH: string[], newH: string[]): [number, number][] {
  const n = oldH.length;
  const m = newH.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldH[i] === newH[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldH[i] === newH[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * `oldBlocks` are the live rows (not soft-deleted) in `n` order; `newSrc` is the body to fold in.
 * A row already soft-deleted is never resurrected by an identical text showing up again — the id
 * stays buried and the text lands as a new block.
 */
export function reconcileBlocks(oldBlocks: OldBlock[], newSrc: string): ReconcilePlan {
  const fresh = parseContentBlocks(newSrc);
  const plan: ReconcilePlan = { live: [], added: [], removed: [] };
  const anchors = lcsMatches(oldBlocks.map((b) => b.hash), fresh.map((s) => s.hash));

  const take = (oStart: number, oEnd: number, nStart: number, nEnd: number) => {
    const olds = oldBlocks.slice(oStart, oEnd);
    const news = fresh.slice(nStart, nEnd);
    const usedOld = new Set<number>();
    const usedNew = new Set<number>();
    const pairs: { o: number; n: number; s: number }[] = [];
    for (let a = 0; a < olds.length; a++)
      for (let b = 0; b < news.length; b++) {
        if (olds[a].kind !== news[b].kind) continue;
        const s = similarity(olds[a].text, news[b].text);
        if (s >= SIM_THRESHOLD) pairs.push({ o: a, n: b, s });
      }
    pairs.sort((x, y) => y.s - x.s);
    for (const p of pairs) {
      if (usedOld.has(p.o) || usedNew.has(p.n)) continue;
      usedOld.add(p.o);
      usedNew.add(p.n);
      plan.live.push({ id: olds[p.o].id, spec: news[p.n], n: nStart + p.n, modified: true });
    }
    for (let a = 0; a < olds.length; a++) if (!usedOld.has(a)) plan.removed.push(olds[a].id);
    for (let b = 0; b < news.length; b++) if (!usedNew.has(b)) plan.added.push({ spec: news[b], n: nStart + b });
  };

  let oi = 0;
  let ni = 0;
  for (const [i, j] of anchors) {
    take(oi, i, ni, j);
    plan.live.push({ id: oldBlocks[i].id, spec: fresh[j], n: j, modified: false });
    oi = i + 1;
    ni = j + 1;
  }
  take(oi, oldBlocks.length, ni, fresh.length);
  return plan;
}

/** Id format for new blocks. */
export const contentBlockId = () => `cb_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

/** Re-export for callers that hash raw text the same way the parser does. */
export { blockHash };

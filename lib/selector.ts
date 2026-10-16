import { makeSelector, type QuoteSelector } from "./anchor";

export type SelectorResult = { ok: true; selector: QuoteSelector } | { ok: false; error: string };

/**
 * Selector for the n-th (1-based) occurrence of `quote` in a doc's plain text, so an agent can
 * comment on a passage by naming it. Whitespace runs in the quote match any whitespace.
 */
export function selectorFor(text: string, quote: string, occurrence = 1): SelectorResult {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { ok: false, error: "quote is empty" };
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) return { ok: false, error: `quote not found in the doc: "${quote}"` };
  if (occurrence < 1 || occurrence > hits.length) {
    return { ok: false, error: `quote occurs ${hits.length} time(s); --occurrence must be 1..${hits.length}` };
  }
  const m = hits[occurrence - 1];
  const start = m.index ?? 0;
  return { ok: true, selector: makeSelector(text, start, start + m[0].length) };
}

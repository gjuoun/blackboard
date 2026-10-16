/** A passage as the reader saw it: the text, plus a little text on each side to tell repeats apart. */
export type QuoteSelector = { exact: string; prefix: string; suffix: string };
export type TextRange = { start: number; end: number };

export const CONTEXT_CHARS = 32;

const squash = (s: string) => s.replace(/\s+/g, " ");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build a selector for text[start, end) of a doc's plain text. */
export function makeSelector(text: string, start: number, end: number, context = CONTEXT_CHARS): QuoteSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - context), start),
    suffix: text.slice(end, end + context),
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Find the passage again in a doc's plain text, or null when it is gone (the comment is orphaned).
 * Every occurrence of `exact` is a candidate, with any run of whitespace matching any other so a
 * re-wrapped line still matches. Candidates are scored by how much of the stored prefix and suffix
 * still surround them; the best wins and the earliest breaks a tie.
 */
export function anchor(text: string, sel: QuoteSelector): TextRange | null {
  const words = sel.exact.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const lead = sel.exact.match(/^\s*/)?.[0] ?? "";
  const trail = sel.exact.match(/\s*$/)?.[0] ?? "";
  const re = new RegExp(words.map(escapeRe).join("\\s+"), "g");
  const prefix = squash(sel.prefix + lead);
  const suffix = squash(trail + sel.suffix);

  let best: (TextRange & { score: number }) | null = null;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = squash(text.slice(Math.max(0, start - prefix.length - 16), start));
    const after = squash(text.slice(end, end + suffix.length + 16));
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (!best || score > best.score) best = { start, end, score };
  }
  return best ? { start: best.start, end: best.end } : null;
}

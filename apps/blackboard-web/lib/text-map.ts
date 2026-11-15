/**
 * Browser helpers that map between the DOM of a rendered doc and its plain text, so comments
 * can be stored as text offsets and drawn back as DOM Ranges. Diagram blocks and formulas are
 * skipped: their SVG text is generated in the browser, or KaTeX's glyphs repeat the TeX, and either
 * would shift every offset after it. A formula is one opaque unit with no text in the map.
 */

const SKIP_SELECTOR = "[data-testid=mermaid], [data-testid=math]";

export type TextMap = { text: string; nodes: { node: Text; start: number }[] };

export function buildTextMap(root: HTMLElement): TextMap {
  const nodes: TextMap["nodes"] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += n.textContent ?? "";
  }
  return { text, nodes };
}

/** Text offset of a DOM boundary point (container, offset). */
export function offsetOf(map: TextMap, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const hit = map.nodes.find((n) => n.node === container);
    if (hit) return hit.start + offset;
  }
  const point = document.createRange();
  point.setStart(container, offset);
  for (const n of map.nodes) {
    if (point.comparePoint(n.node, 0) >= 0) return n.start;
  }
  return map.text.length;
}

/** DOM Range covering text[start, end). */
export function rangeOf(map: TextMap, start: number, end: number): Range | null {
  const at = (pos: number, preferNext: boolean) => {
    for (let i = 0; i < map.nodes.length; i++) {
      const n = map.nodes[i];
      const len = n.node.length;
      if (pos < n.start + len || (pos === n.start + len && !preferNext) || i === map.nodes.length - 1) {
        if (pos >= n.start) return { node: n.node, offset: Math.min(pos - n.start, len) };
      }
    }
    return null;
  };
  const s = at(start, true);
  const e = at(end, false);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

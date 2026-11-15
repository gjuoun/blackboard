/**
 * One-time DOM preparation for the virtualized doc body, run while the whole doc is still
 * mounted in normal flow: snapshot the full text map (comment coordinates stay whole-doc),
 * read each top-level element's margins, and insert the two height spacers the window
 * controller positions. The runtime lives in `lib/virtualize-dom.ts`; the pure model in
 * `lib/virtualize.ts`.
 */
import { buildTextMap, type TextMap } from "./text-map";
import { planChunks, type ChunkInput, type VAnchor, type VPlan } from "./virtualize";

export type Chunked = { plan: VPlan; map: TextMap; blocks: HTMLElement[]; top: HTMLElement; bottom: HTMLElement };

const spacer = (name: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = "vspacer";
  el.dataset.vspacer = name;
  el.style.margin = "0";
  el.style.display = "none";
  return el;
};

/**
 * Chunk a fully mounted `.doc-body` for virtualization. Returns null when the body holds stray
 * top-level text (this renderer never emits any, but raw HTML could) — such a doc stays on the
 * plain path rather than losing text nodes from the flow.
 */
export function chunkDocBody(body: HTMLElement): Chunked | null {
  for (const n of body.childNodes) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) return null;
  const map = buildTextMap(body);
  const kids = [...body.children] as HTMLElement[];
  const inputs: ChunkInput[] = [];
  // One read-only pass while everything is still in flow: margins become the model's gaps,
  // ids and nested headings become jump anchors at their offset inside the block.
  for (const el of kids) {
    const cs = getComputedStyle(el);
    const top = el.getBoundingClientRect().top;
    const anchors: VAnchor[] = [];
    if (el.id) anchors.push({ id: el.id, within: 0 });
    for (const h of el.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")) {
      const within = h.getBoundingClientRect().top - top;
      if (within >= 0) anchors.push({ id: h.id, within });
    }
    inputs.push({ kind: el.tagName.toLowerCase(), marginTop: parseFloat(cs.marginTop) || 0, marginBottom: parseFloat(cs.marginBottom) || 0, anchors });
  }
  const plan = planChunks(inputs);
  const top = spacer("top");
  const bottom = spacer("bottom");
  body.insertBefore(top, kids[0]?.nextSibling ?? null);
  body.appendChild(bottom);
  body.setAttribute("data-virt", "");
  // The virtualizer pays back height changes itself; the browser's own scroll anchoring would
  // compensate the same layout shift a second time and jump the reader.
  body.style.overflowAnchor = "none";
  for (const el of kids) el.style.overflowAnchor = "none";
  return { plan, map, blocks: kids, top, bottom };
}

/** Undo the chunking exactly: put every block back in document order, drop the spacers. */
export function unchunkDocBody(body: HTMLElement, blocks: readonly HTMLElement[], top: HTMLElement, bottom: HTMLElement): void {
  for (const el of blocks) body.appendChild(el);
  body.style.overflowAnchor = "";
  for (const el of blocks) el.style.overflowAnchor = "";
  top.remove();
  bottom.remove();
  body.removeAttribute("data-virt");
}


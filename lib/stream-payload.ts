/**
 * Adopting a stream page's served body for virtualization: the server ships the window's
 * sections already rendered and every skipped exchange as a `data-pending` placeholder with
 * `data-est` carrying its estimated height. This file turns that mixed DOM into the Chunked
 * the VirtualDoc wants — same shape `chunkDocBody` produces for a plain doc, but reading the
 * estimate off the placeholder instead of falling back to a kind default. A comment anchored
 * on an exchange that was never shipped cannot resolve until its block loads; that limitation
 * is called out on the panel, and the exchange highlights once its HTML arrives.
 */
import { buildTextMap } from "./text-map";
import { planChunks, type ChunkInput } from "./virtualize";
import type { Chunked } from "./virtualize-chunk";

/** Marker names shared with StreamBody and the lazy loader: pending sections carry the id and
 *  the server's estimate until /api/stream-blocks fills them. */
export const PENDING_ATTR = "data-pending";
export const EST_ATTR = "data-est";

const spacer = (name: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = "vspacer";
  el.dataset.vspacer = name;
  el.style.margin = "0";
  el.style.display = "none";
  return el;
};

/**
 * Chunk a body of stream sections — rendered blocks and `data-pending` placeholders — for
 * virtualization. Returns null on stray top-level text (the renderer never emits any). Unlike
 * `chunkDocBody` this never reads `body.getBoundingClientRect()` for a whole-doc height: the
 * server already decided this doc is windowed, so adoption is unconditional. Estimated heights
 * come from each placeholder's `data-est`; mounted sections measure on their first observe.
 */
export function adoptStreamBody(body: HTMLElement): Chunked | null {
  for (const n of body.childNodes) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) return null;
  const kids = [...body.children] as HTMLElement[];
  const inputs: ChunkInput[] = [];
  for (const el of kids) {
    const cs = getComputedStyle(el);
    const top = el.getBoundingClientRect().top;
    const anchors: { id: string; within: number }[] = [];
    if (el.id) anchors.push({ id: el.id, within: 0 });
    if (!el.hasAttribute(PENDING_ATTR)) {
      for (const h of el.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")) {
        const within = h.getBoundingClientRect().top - top;
        if (within >= 0) anchors.push({ id: h.id, within });
      }
    }
    const est = el.getAttribute(EST_ATTR);
    inputs.push({
      kind: el.tagName.toLowerCase(),
      marginTop: parseFloat(cs.marginTop) || 0,
      marginBottom: parseFloat(cs.marginBottom) || 0,
      anchors,
      ...(est !== null ? { estimated: parseFloat(est) || undefined } : {}),
    });
  }
  const plan = planChunks(inputs);
  const top = spacer("top");
  const bottom = spacer("bottom");
  body.insertBefore(top, kids[0]?.nextSibling ?? null);
  body.appendChild(bottom);
  body.setAttribute("data-virt", "");
  body.style.overflowAnchor = "none";
  for (const el of kids) el.style.overflowAnchor = "none";
  // The map covers only the exchanges the first screen shipped; the lazy loader fills each
  // placeholder in place, so a quote on a pending block resolves as soon as its html lands.
  const map = buildTextMap(body);
  return { plan, map, blocks: kids, top, bottom };
}

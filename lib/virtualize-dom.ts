/**
 * The live half of the virtualized doc body: keep only the viewport (± overscan) mounted — in
 * normal flow between the two spacers `lib/virtualize-chunk.ts` inserted, so every selector,
 * every collapsing margin and every element's internal layout behave exactly as on a plain doc
 * (absolutely positioning the blocks would turn them into BFCs and change how margins collapse
 * through them). Heights come from a ResizeObserver per mounted block; a late change above the
 * viewport is paid back to the scroll position; jumps to unmounted ids land with a settle
 * loop. The pure window math is `lib/virtualize.ts`; the mechanism is ported from the approved
 * sketch (`sketches/virtualized-doc/virtualizer.js`).
 */
import type { TextMap } from "./text-map";
import { anchorAdjust, bottomSpacerHeight, computeRange, landingOffset, rebuildOffsets, topSpacerHeight, wantedIndices, type VDelta, type VPlan } from "./virtualize";
import { unchunkDocBody, type Chunked } from "./virtualize-chunk";

export type VirtualDocOpts = {
  overscan?: number;
  /** A block (re)mounted into the document; diagrams inside it may still need drawing. */
  onMount?: (el: HTMLElement) => void;
  /** The mounted window changed (blocks entered or left it). */
  onWindowChange?: () => void;
};

export class VirtualDoc {
  readonly map: TextMap;
  private readonly body: HTMLElement;
  private readonly plan: VPlan;
  private readonly blocks: HTMLElement[];
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly opts: VirtualDocOpts;
  private readonly overscan: number;
  private readonly index = new Map<HTMLElement, number>();
  private heights: (number | null)[];
  private offsets: number[];
  private mounted = new Map<number, HTMLElement>();
  private ro: ResizeObserver;
  private raf = 0;
  private suspendAnchor = false;
  private jump: { i: number; within: number; id: string; tick: number; stable: number; lastY: number | null } | null = null;

  constructor(body: HTMLElement, chunked: Chunked, opts: VirtualDocOpts = {}) {
    this.body = body;
    this.plan = chunked.plan;
    this.blocks = chunked.blocks;
    this.top = chunked.top;
    this.bottom = chunked.bottom;
    this.map = chunked.map;
    this.opts = opts;
    this.overscan = opts.overscan ?? 8;
    this.heights = new Array<number | null>(this.plan.blocks.length).fill(null);
    this.offsets = rebuildOffsets(this.heights, this.plan.blocks);
    for (let i = 0; i < this.blocks.length; i++) this.index.set(this.blocks[i], i);
    // Every block is in the document at construction (the chunker left them in place); adopt
    // that as the mounted set so the first render really prunes to the window.
    for (let i = 0; i < this.blocks.length; i++) this.mounted.set(i, this.blocks[i]);
    this.ro = new ResizeObserver((entries) => this.onResize(entries));
    addEventListener("scroll", this.onScroll, { passive: true });
    addEventListener("resize", this.onScroll);
    addEventListener("wheel", this.onUserNav, { passive: true });
    addEventListener("keydown", this.onUserNav);
    this.render(true);
  }

  destroy(): void {
    this.ro.disconnect();
    removeEventListener("scroll", this.onScroll);
    removeEventListener("resize", this.onScroll);
    removeEventListener("wheel", this.onUserNav);
    removeEventListener("keydown", this.onUserNav);
    cancelAnimationFrame(this.raf);
    this.jump = null;
    this.suspendAnchor = false;
    this.mounted.clear();
    unchunkDocBody(this.body, this.blocks, this.top, this.bottom);
  }

  /* ---- positions others ask for ---- */

  /** The body's top in page coordinates. */
  docTop(): number {
    return this.body.getBoundingClientRect().top + scrollY;
  }

  /** An id's top offset inside the body (measured or estimated), or null when unknown. */
  topForId(id: string): number | null {
    const a = this.plan.anchors.get(id);
    return a ? this.offsets[a.i] + a.within : null;
  }

  mountedCount(): number {
    return this.mounted.size;
  }

  /* ---- jumping ---- */

  /** Jump to an id that may not be mounted: land it under the bar and hold it there for a few
   *  frames, because the measurement batch after the jump rewrites the offsets above it. */
  scrollToId(id: string): boolean {
    const a = this.plan.anchors.get(id);
    if (!a) return false;
    this.suspendAnchor = true;
    this.jump = { ...a, id, tick: 0, stable: 0, lastY: null };
    this.render(true);
    // Instant on purpose: the app's html sets scroll-behavior smooth, and an animated jump
    // would run while the virtualizer reflows the page underneath it and abort halfway.
    scrollTo({ top: this.docTop() + landingOffset(this.offsets, a, this.topInset(id)), behavior: "instant" });
    this.render(true);
    this.settle();
    return true;
  }

  cancelJump(): void {
    if (!this.jump) return;
    this.jump = null;
    this.suspendAnchor = false;
  }

  private settle(): void {
    const j = this.jump;
    if (!j) return;
    // Anything that moves the scroll without this loop is the reader taking over.
    if (j.lastY != null && Math.abs(scrollY - j.lastY) > 4) {
      this.cancelJump();
      return;
    }
    const el = this.anchorEl(j.id);
    if (el) {
      const d = el.getBoundingClientRect().top - this.topInset(j.id);
      if (Math.abs(d) > 1) {
        scrollBy({ top: d, behavior: "instant" });
        j.stable = 0;
        this.render(true);
      } else {
        j.stable += 1;
      }
    }
    j.lastY = scrollY;
    j.tick += 1;
    if (j.tick > 24 || (j.tick >= 12 && j.stable >= 3)) {
      this.jump = null;
      this.suspendAnchor = false;
    } else {
      requestAnimationFrame(() => this.settle());
    }
  }

  /** The element an id lives in, when its block is mounted (the block element itself, or the
   *  nested heading inside it). */
  private anchorEl(id: string): HTMLElement | null {
    const a = this.plan.anchors.get(id);
    if (!a) return null;
    const block = this.mounted.get(a.i);
    if (!block) return null;
    if (a.within === 0) return block;
    for (const el of block.querySelectorAll<HTMLElement>("[id]")) if (el.id === id) return el;
    return null;
  }

  /** Where a jumped-to heading should sit: its own scroll-margin (bar + room, phone-aware). */
  private topInset(id: string): number {
    const el = this.anchorEl(id);
    if (el) {
      const m = parseFloat(getComputedStyle(el).scrollMarginTop);
      if (Number.isFinite(m) && m >= 0) return m;
    }
    const bar = parseFloat(getComputedStyle(this.body).getPropertyValue("--bar-h"));
    return (Number.isFinite(bar) ? bar : 52) + 12;
  }

  /* ---- rendering ---- */

  private viewTop(): number {
    return scrollY - this.docTop();
  }

  private onScroll = () => this.schedule();

  private onUserNav = () => this.cancelJump();

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render(false);
    });
  }

  private mount(i: number): void {
    const el = this.blocks[i];
    // Block 0 mounts before the top spacer (it owns the body's first-child slot); the rest
    // keep document order, so text offsets and selection geometry stay consistent.
    if (i === 0) {
      this.body.insertBefore(el, this.top);
    } else {
      let next: HTMLElement | null = null;
      for (const [j, m] of this.mounted) if (j > i && (!next || j < this.index.get(next)!)) next = m;
      this.body.insertBefore(el, next ?? this.bottom);
    }
    this.mounted.set(i, el);
    this.ro.observe(el);
    this.opts.onMount?.(el);
  }

  private unmount(el: HTMLElement): void {
    this.ro.unobserve(el);
    el.remove();
    this.mounted.delete(this.index.get(el)!);
  }

  private render(force: boolean): void {
    const n = this.plan.blocks.length;
    // While jumping, the window lives around the target, not around the current scroll: a
    // block pinned outside the window would otherwise flow in adjacent to it (in-flow model)
    // instead of at its offset, and the landing scroll would clamp against a short page.
    const range = computeRange(this.offsets, this.jump ? this.offsets[this.jump.i] : this.viewTop(), innerHeight, this.overscan);
    const wanted = new Set(wantedIndices(n, range));
    // Block 0 stays mounted: it is the body's `:first-child`, whose margin-top the app CSS
    // zeroes — as the window slides, any other block becoming the DOM-first element would pick
    // up that rule and render off its modelled position.
    wanted.add(0);
    if (this.jump) wanted.add(this.jump.i);
    let changed = force && this.mounted.size > 0;
    if (force) for (const el of [...this.mounted.values()]) this.unmount(el);
    for (const [i, el] of [...this.mounted]) if (!wanted.has(i)) {
      this.unmount(el);
      changed = true;
    }
    for (const i of wanted) if (!this.mounted.has(i)) {
      this.mount(i);
      changed = true;
    }
    this.placeSpacers();
    if (changed) this.opts.onWindowChange?.();
  }

  /** Position the two spacers from the current offsets: the mounted window keeps its true place
   *  in the document while everything around it stays unmounted. */
  private placeSpacers(): void {
    let first = Infinity;
    let last = -1;
    for (const i of this.mounted.keys()) {
      if (i > 0 && i < first) first = i;
      if (i > last) last = i;
    }
    const topH = last < 0 ? null : topSpacerHeight(this.offsets, this.plan.blocks, this.heights, first);
    if (topH == null || topH <= 0) {
      this.top.style.display = "none";
    } else {
      this.top.style.display = "";
      this.top.style.height = `${topH}px`;
    }
    const bottomH = last < 0 ? null : bottomSpacerHeight(this.offsets, this.plan.blocks, this.heights, last);
    if (bottomH == null || bottomH <= 0) {
      this.bottom.style.display = "none";
    } else {
      this.bottom.style.display = "";
      this.bottom.style.height = `${bottomH}px`;
    }
  }

  /* ---- measurement ---- */

  private onResize(entries: ResizeObserverEntry[]): void {
    const viewTop = Math.max(0, this.viewTop());
    const deltas: VDelta[] = [];
    let changed = false;
    for (const e of entries) {
      const i = this.index.get(e.target as HTMLElement);
      if (i === undefined || i >= this.plan.blocks.length) continue;
      const h = e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).getBoundingClientRect().height;
      const old = this.heights[i];
      if (old != null && Math.abs(old - h) < 1) continue;
      // Only a change from a previously measured height can owe payback: a first measurement
      // above the viewport (a deep link mounts its window mid-document) was never displayed at
      // the estimate, so nothing the reader sees has moved.
      if (old != null) deltas.push({ i, from: old, to: h });
      this.heights[i] = h;
      changed = true;
    }
    if (!changed) return;
    const adjust = this.suspendAnchor ? 0 : anchorAdjust(this.offsets, viewTop, deltas);
    this.offsets = rebuildOffsets(this.heights, this.plan.blocks);
    if (adjust) scrollBy({ top: adjust, behavior: "instant" });
    this.placeSpacers();
    this.schedule();
  }
}

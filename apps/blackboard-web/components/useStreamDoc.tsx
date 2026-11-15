"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { adoptStreamBody, PENDING_ATTR } from "@/lib/stream-payload";
import { VirtualDoc } from "@/lib/virtualize-dom";
import type { VirtualDocHandle, VirtualDocView } from "./useVirtualDoc";

/** What the page hands the stream virtualizer: the window the server computed. */
export type StreamDocInput = { id: string; total: number; epoch: string; vh: number };

const DISABLED: VirtualDocHandle = { enabled: () => false, textMap: () => null, scrollToId: () => false, topForId: () => null, docTop: () => 0 };

/** One html range request per contiguous gap of unfetched blocks. The lazy content endpoint.
 *  A comment anchored on an exchange that was never shipped stays orphaned in the panel until
 *  its block loads — the loader fills the placeholder and the quote resolves. */
export async function fetchBlocks(id: string, from: number, to: number): Promise<{ id: string; n: number; html: string }[]> {
  const res = await fetch(`/api/stream-blocks?id=${encodeURIComponent(id)}&from=${from}&to=${to}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { blocks: { id: string; n: number; html: string }[] };
  return data.blocks;
}

/** Coalesce a set of wanted block indexes into ≤24-at-a-time ranges. */
export function groupRanges(wanted: readonly number[]): { from: number; to: number }[] {
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out: { from: number; to: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1 && sorted[j + 1] - sorted[i] < 24) j++;
    out.push({ from: sorted[i], to: sorted[j] });
    i = j + 1;
  }
  return out;
}

/**
 * The stream page's virtualization and lazy loading. Same contract as useVirtualDoc: returns
 * a VirtualDocView the rest of the view uses. Differences: it adopts a body that already mixes
 * rendered sections and data-pending placeholders, it fetches /api/stream-blocks for whatever
 * the window wants that the server did not ship, and on an epoch change (SSE refresh) it
 * restores the scroll position instead of restarting at the top.
 */
export function useStreamDoc({ stream, bodyRef }: { stream?: StreamDocInput; bodyRef: RefObject<HTMLElement | null> }): VirtualDocView {
  const ctrl = useRef<VirtualDoc | null>(null);
  const bumpRaf = useRef(0);
  const [version, setVersion] = useState(0);
  // The fetched html cache survives an epoch rebuild so a refresh never re-downloads what the
  // reader already loaded. Cleared when the session changes, not per epoch.
  const cache = useRef<Map<string, string>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const loaded = useRef<Set<string>>(new Set());
  const epoch = stream?.epoch ?? "";
  const prevEpoch = useRef<string | null>(null);
  const topAnchor = useRef<{ id: string; within: number } | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !stream || body.children.length === 0) return;
    // One live controller is the whole state: React may clean this effect up and re-run it
    // (a re-render during hydration does), and a destroyed controller must be rebuilt rather
    // than left as an empty body. `prevEpoch` only decides what to restore, not whether to build.
    if (ctrl.current) return;

    // Remember where the reader was before the rebuild; restore it after the new controller
    // adopts the fresh body. A following reader goes back to the tail instead.
    const restore = topAnchor.current;
    topAnchor.current = null;
    prevEpoch.current = epoch;

    const chunked = adoptStreamBody(body);
    if (!chunked) return;
    const v = new VirtualDoc(body, chunked, {
      pending: true,
      pinTail: true,
      onMount: (el) => void import("./Mermaid").then((m) => void m.renderMermaidIn(el)),
      onWindowChange: () => {
        if (bumpRaf.current) return;
        bumpRaf.current = requestAnimationFrame(() => {
          bumpRaf.current = 0;
          setVersion((n) => n + 1);
        });
      },
      onWanted: (indices) => {
        // Fetch whatever the window wants that the server skipped; a block the cache already
        // holds fills instantly (a refresh re-pends it but keeps the html). Ranges batch ≤24.
        const pending = indices.filter((i) => {
          const el = chunked.blocks[i];
          return el?.hasAttribute(PENDING_ATTR) && !inFlight.current.has(el.id) && !loaded.current.has(el.id);
        });
        if (pending.length === 0) return;
        for (const r of groupRanges(pending)) {
          const ids = new Set(chunked.blocks.slice(r.from, r.to + 1).map((el) => el?.id).filter(Boolean) as string[]);
          // Serve cached html without a round trip.
          for (const el of chunked.blocks.slice(r.from, r.to + 1)) {
            if (!el) continue;
            const cached = cache.current.get(el.id);
            if (cached !== undefined) {
              loaded.current.add(el.id);
              v.load(el, cached);
            }
          }
          const missing = [...ids].filter((id) => !cache.current.has(id));
          if (missing.length === 0) continue;
          missing.forEach((id) => inFlight.current.add(id));
          void fetchBlocks(stream.id, r.from, r.to).then((fetched) => {
            for (const b of fetched) {
              const el = chunked.blocks.find((e) => e?.id === b.id);
              if (!el) continue;
              cache.current.set(b.id, b.html);
              loaded.current.add(b.id);
              v.load(el, b.html);
            }
            missing.forEach((id) => inFlight.current.delete(id));
          });
        }
      },
    });
    ctrl.current = v;
    setVersion((n) => n + 1);

    // Deep link: the hash can name a block the server skipped. scrollToId lands on the
    // estimate, wants the block, and settle() keeps re-landing until its real height is known.
    const hashId = decodeURIComponent(location.hash.slice(1));
    if (hashId) v.scrollToId(hashId);
    else if (restore) {
      // Refresh: the reader was mid-document. Land the same block again; the within offset
      // re-applies after its real height is measured.
      if (v.scrollToId(restore.id)) requestAnimationFrame(() => scrollBy({ top: restore.within, behavior: "instant" }));
    }
    return () => {
      // Capture the anchor before unmounting so the next build can restore it.
      const mounted = chunked.blocks.findIndex((el) => el && !el.hasAttribute(PENDING_ATTR) && el.getBoundingClientRect().bottom > scrollY);
      const el = mounted >= 0 ? chunked.blocks[mounted] : null;
      if (el?.id) topAnchor.current = { id: el.id, within: scrollY - el.getBoundingClientRect().top };
      v.destroy();
      ctrl.current = null;
    };
  }, [bodyRef, stream, epoch]);

  const handle = useMemo<VirtualDocHandle>(
    () => ({
      enabled: () => ctrl.current !== null,
      textMap: () => ctrl.current?.map ?? null,
      scrollToId: (id) => ctrl.current?.scrollToId(id) ?? false,
      topForId: (id) => ctrl.current?.topForId(id) ?? null,
      docTop: () => ctrl.current?.docTop() ?? 0,
    }),
    [],
  );
  return useMemo(() => ({ handle, version }), [handle, version]);
}

export { DISABLED };

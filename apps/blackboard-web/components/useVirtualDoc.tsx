"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { TextMap } from "@/lib/text-map";
import { shouldVirtualize } from "@/lib/virtualize";
import { chunkDocBody } from "@/lib/virtualize-chunk";
import { VirtualDoc } from "@/lib/virtualize-dom";
import { renderMermaidIn } from "./Mermaid";

/** What the rest of the view can ask of the virtualizer. Every method reads the controller
 *  live, so it works inside effects and handlers that ran before the last render. */
export type VirtualDocHandle = {
  /** True once the doc chunked past the threshold and the virtualizer took over. */
  enabled(): boolean;
  /** The full-doc text map, snapshotted before any node moved, or null while not virtualized. */
  textMap(): TextMap | null;
  scrollToId(id: string): boolean;
  topForId(id: string): number | null;
  docTop(): number;
};

export type VirtualDocView = { handle: VirtualDocHandle; version: number };

const DISABLED: VirtualDocHandle = { enabled: () => false, textMap: () => null, scrollToId: () => false, topForId: () => null, docTop: () => 0 };

const VirtualDocContext = createContext<VirtualDocView>({ handle: DISABLED, version: 0 });

export const useVirtualDocContext = (): VirtualDocView => useContext(VirtualDocContext);

/**
 * Virtualize the doc body rendered into `bodyRef` by `DocBody`, when it is big enough (≥300
 * top-level blocks or ≥10 viewports tall). Below the threshold nothing happens at all: no
 * wrappers, no observers, no attributes. The `version` rises whenever the mounted window
 * changes, so comment anchoring and the TOC can redo their work against the new DOM.
 */
export function useVirtualDoc({ html, bodyRef, pinTail, disabled }: { html: string; bodyRef: RefObject<HTMLElement | null>; pinTail?: boolean; disabled?: boolean }): VirtualDocView {
  const ctrl = useRef<VirtualDoc | null>(null);
  const bumpRaf = useRef(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (disabled) return;
    const body = bodyRef.current;
    if (!body || body.children.length === 0) return;
    // The body is still fully mounted in flow here, so its height is the real one.
    if (!shouldVirtualize(body.children.length, body.getBoundingClientRect().height, window.innerHeight)) return;
    const chunked = chunkDocBody(body);
    if (!chunked) return;
    const v = new VirtualDoc(body, chunked, {
      pinTail,
      onMount: (el) => void renderMermaidIn(el),
      onWindowChange: () => {
        if (bumpRaf.current) return;
        bumpRaf.current = requestAnimationFrame(() => {
          bumpRaf.current = 0;
          setVersion((n) => n + 1);
        });
      },
    });
    ctrl.current = v;
    setVersion((n) => n + 1);
    // A deep link arrived before the geometry existed; land it now that it does.
    const hashId = decodeURIComponent(location.hash.slice(1));
    if (hashId) v.scrollToId(hashId);
    return () => {
      v.destroy();
      ctrl.current = null;
    };
  }, [html, bodyRef, pinTail, disabled]);

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

export function VirtualDocProvider({ value, children }: { value: VirtualDocView; children: ReactNode }) {
  return <VirtualDocContext.Provider value={value}>{children}</VirtualDocContext.Provider>;
}

/**
 * An in-doc `#heading` link whose target may be unmounted has nothing for the native anchor
 * jump to find; route it through the virtualizer and set the hash without a native jump.
 * Returns true when the click was handled.
 */
export function interceptHashClick(e: MouseEvent<HTMLElement>, virt: VirtualDocHandle): boolean {
  const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#"]');
  if (!(a instanceof HTMLAnchorElement)) return false;
  const id = decodeURIComponent(a.hash.slice(1));
  if (!id || !virt.enabled() || !virt.scrollToId(id)) return false;
  e.preventDefault();
  history.pushState(null, "", `#${id}`);
  return true;
}

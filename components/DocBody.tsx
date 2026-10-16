"use client";

import { useEffect, useRef } from "react";
import { renderMermaidIn } from "./Mermaid";

/** The rendered doc. Diagrams are drawn in the browser after the HTML lands. */
export function DocBody({ html }: { html: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) void renderMermaidIn(ref.current);
  }, [html]);
  return <article ref={ref} className="doc-body" data-testid="doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

"use client";

import { memo, useEffect, type Ref, type RefObject } from "react";
import { renderMermaidIn } from "./Mermaid";

type Mouse = (e: React.MouseEvent<HTMLElement>) => void;
type Props = { html: string; ref: Ref<HTMLElement>; onClick?: Mouse; onMouseMove?: Mouse; onMouseLeave?: Mouse };

/**
 * The rendered doc. Memoised on the HTML so a comment change never resets the DOM (which would
 * drop the reader's selection and the drawn diagrams). Diagrams are drawn after the HTML lands.
 */
export const DocBody = memo(function DocBody({ html, ref, onClick, onMouseMove, onMouseLeave }: Props) {
  useEffect(() => {
    const el = (ref as RefObject<HTMLElement | null>).current;
    if (el) void renderMermaidIn(el);
  }, [html, ref]);
  return <article ref={ref} className="doc-body" data-testid="doc-body" onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      dangerouslySetInnerHTML={{ __html: html }} />;
});

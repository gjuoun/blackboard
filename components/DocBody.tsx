"use client";

import { memo, useEffect, type ReactNode, type Ref, type RefObject } from "react";
import { renderMermaidIn } from "./Mermaid";

type Mouse = (e: React.MouseEvent<HTMLElement>) => void;
type Props = {
  html?: string;
  ref: Ref<HTMLElement>;
  /** Rendered children (a streamed doc's timeline sections). Overrides `html` when present. */
  children?: ReactNode;
  onClick?: Mouse;
  onMouseMove?: Mouse;
  onMouseLeave?: Mouse;
};

/**
 * The rendered doc. Memoised on the HTML so a comment change never resets the DOM (which would
 * drop the reader's selection and the drawn diagrams). A streamed doc hands rendered timeline
 * sections as children instead of one html string. Diagrams are drawn after the content lands.
 */
export const DocBody = memo(function DocBody({ html, ref, children, onClick, onMouseMove, onMouseLeave }: Props) {
  useEffect(() => {
    const el = (ref as RefObject<HTMLElement | null>).current;
    if (el) void renderMermaidIn(el);
  }, [html, children, ref]);
  return (
    <article
      ref={ref}
      className="doc-body"
      data-testid="doc-body"
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      {...(children ? {} : { dangerouslySetInnerHTML: { __html: html ?? "" } })}
    >
      {children}
    </article>
  );
});

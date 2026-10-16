"use client";

/** The rendered doc. A client component so later layers can add diagrams and highlights. */
export function DocBody({ html }: { html: string }) {
  return <article className="doc-body" data-testid="doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

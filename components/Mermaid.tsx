"use client";

let counter = 0;

/**
 * Render every mermaid placeholder inside `root`. Mermaid is imported from the app bundle,
 * not a CDN, so diagrams work offline. A diagram with a syntax error keeps its source and
 * shows the error instead of breaking the page.
 */
export async function renderMermaidIn(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-testid=mermaid]:not([data-rendered])")];
  if (blocks.length === 0) return;
  // Claim the blocks before any await: two concurrent callers (React StrictMode runs the
  // effect twice) would otherwise both pass the :not([data-rendered]) filter and render
  // the diagram twice into the same block.
  for (const block of blocks) block.dataset.rendered = "true";
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", flowchart: { nodeSpacing: 60, rankSpacing: 70 } });
  for (const block of blocks) {
    const src = block.querySelector(".mermaid-src")?.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`bb-mermaid-${++counter}`, src);
      const out = document.createElement("div");
      out.className = "mermaid-svg";
      out.innerHTML = svg;
      block.append(out);
      block.classList.add("is-rendered");
    } catch (err) {
      const note = document.createElement("p");
      note.className = "mermaid-error";
      note.textContent = `Diagram error: ${err instanceof Error ? err.message : String(err)}`;
      block.append(note);
    }
  }
}

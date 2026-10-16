import type { Element, Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import type { FootnoteDefinition, PhrasingContent, Root as MdastRoot } from "mdast";
import { toString as mdToString } from "mdast-util-to-string";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export type TocEntry = { depth: number; id: string; text: string };
export type Rendered = { html: string; toc: TocEntry[] };

/** A node remark-rehype turns into the element named by data.hName. */
type HNode = { type: string; data: { hName: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] }; children?: PhrasingContent[] };

const MARK = /==([^=\n]+)==/g;

/**
 * Jun's existing review habit is `==passage==[^n]`. Show those as read-only highlights with the
 * footnote as a tooltip, so old notes stay visible without pretending to be Blackboard comments.
 */
function remarkLegacyMarks() {
  return (tree: MdastRoot) => {
    const notes = new Map<string, string>();
    visit(tree, "footnoteDefinition", (d: FootnoteDefinition) => {
      notes.set(d.identifier, mdToString(d));
    });
    visit(tree, (node) => {
      if (!("children" in node) || !Array.isArray(node.children)) return;
      const kids = node.children as PhrasingContent[];
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        if (kid.type !== "text" || !kid.value.includes("==")) continue;
        const parts: (PhrasingContent | HNode)[] = [];
        let last = 0;
        let consumedRef = false;
        for (const m of kid.value.matchAll(MARK)) {
          const start = m.index ?? 0;
          if (start > last) parts.push({ type: "text", value: kid.value.slice(last, start) });
          last = start + m[0].length;
          const props: Record<string, unknown> = { className: ["legacy-mark"], dataTestid: "legacy-mark" };
          const next = kids[i + 1];
          if (last === kid.value.length && next?.type === "footnoteReference") {
            const note = notes.get(next.identifier);
            if (note) props.title = note;
            consumedRef = true;
          }
          parts.push({ type: "legacyMark", data: { hName: "mark", hProperties: props }, children: [{ type: "text", value: m[1] }] });
        }
        if (parts.length === 0) continue;
        if (last < kid.value.length) parts.push({ type: "text", value: kid.value.slice(last) });
        kids.splice(i, consumedRef ? 2 : 1, ...(parts as PhrasingContent[]));
        i += parts.length - 1;
      }
    });
  };
}

/** Mermaid fences become placeholders the browser renders; the source stays visible until then. */
function remarkMermaidBlocks() {
  return (tree: MdastRoot) => {
    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== "mermaid" || !parent || index === undefined) return;
      const block: HNode = {
        type: "mermaidBlock",
        data: {
          hName: "div",
          hProperties: { className: ["mermaid-block"], dataTestid: "mermaid" },
          hChildren: [{ type: "element", tagName: "pre", properties: { className: ["mermaid-src"] }, children: [{ type: "text", value: node.value }] }],
        },
      };
      parent.children.splice(index, 1, block as never);
    });
  };
}

function rehypeCollectToc(toc: TocEntry[]) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      const m = /^h([1-3])$/.exec(el.tagName);
      if (m && typeof el.properties.id === "string") toc.push({ depth: Number(m[1]), id: el.properties.id, text: hastToString(el) });
    });
  };
}

/** Markdown to HTML on the server, so the text a comment anchors against is the same on every load. */
export async function renderMarkdown(src: string): Promise<Rendered> {
  const toc: TocEntry[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLegacyMarks)
    .use(remarkMermaidBlocks)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeCollectToc(toc))
    .use(rehypeStringify)
    .process(src);
  return { html: String(file), toc };
}

import type { Element, ElementContent, Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import type { FootnoteDefinition, PhrasingContent, Root as MdastRoot } from "mdast";
import { toString as mdToString } from "mdast-util-to-string";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";

export type TocEntry = { depth: number; id: string; text: string };
export type Frontmatter = Record<string, unknown>;
export type Rendered = { html: string; toc: TocEntry[]; frontmatter: Frontmatter | null };

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

const el = (tagName: string, properties: Element["properties"], children: ElementContent[]): Element => ({ type: "element", tagName, properties, children });
const txt = (value: string): ElementContent => ({ type: "text", value });

/** Empty values ("", null, [], {}) render as a blank cell. */
const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && Object.keys(v as object).length === 0);

/** One front-matter value as HAST: lists become chips, objects nested tables. */
function fmValue(v: unknown): ElementContent {
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== "object")) {
      return el("ul", { className: ["fm-list"] }, v.map((x) => el("li", { className: ["fm-chip"] }, [txt(String(x ?? ""))])));
    }
    return el("ol", { className: ["fm-items"] }, v.map((x) => el("li", {}, isEmpty(x) ? [] : [fmValue(x)])));
  }
  if (typeof v === "object") return fmTable(v as Frontmatter, "fm-nested");
  const s = String(v);
  if (/^https?:\/\/\S+$/.test(s)) return el("a", { href: s }, [txt(s)]);
  return s.includes("\n") ? el("span", { className: ["fm-text"] }, [txt(s)]) : txt(s);
}

function fmTable(data: Frontmatter, className: string, testid?: string): Element {
  const rows = Object.entries(data).map(([k, v]) => el("tr", {}, [el("th", { scope: "row" }, [txt(k)]), el("td", {}, isEmpty(v) ? [] : [fmValue(v)])]));
  return el("table", testid ? { className: [className], dataTestid: testid } : { className: [className] }, [el("tbody", {}, rows)]);
}

/**
 * YAML front matter (issue cards carry id, status, tags, …) becomes a field/value table instead of
 * a stray rule and a run-on paragraph. Lists and nested maps keep their shape. YAML that does not
 * parse is shown as source with the error, never dropped.
 */
function remarkFrontmatterTable(out: { data: Frontmatter | null }) {
  return () => (tree: MdastRoot) => {
    const first = tree.children[0];
    if (first?.type !== "yaml") return;
    let block: Element;
    try {
      const data = parseYaml(first.value) ?? {};
      if (typeof data !== "object" || Array.isArray(data)) throw new Error("front matter is not a map of fields");
      out.data = data as Frontmatter;
      block = fmTable(out.data, "frontmatter", "frontmatter");
    } catch (err) {
      block = el("div", { className: ["frontmatter-error"], dataTestid: "frontmatter" }, [
        el("p", {}, [txt(`Front matter does not parse: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`)]),
        el("pre", {}, [txt(first.value)]),
      ]);
    }
    const node: HNode = { type: "frontmatterBlock", data: { hName: block.tagName, hProperties: block.properties, hChildren: block.children } };
    tree.children.splice(0, 1, node as never);
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
  const fm: { data: Frontmatter | null } = { data: null };
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkFrontmatterTable(fm))
    .use(remarkGfm)
    .use(remarkLegacyMarks)
    .use(remarkMermaidBlocks)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeCollectToc(toc))
    .use(rehypeStringify)
    .process(src);
  return { html: String(file), toc, frontmatter: fm.data };
}

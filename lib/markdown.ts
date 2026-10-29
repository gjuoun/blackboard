import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { FootnoteDefinition, PhrasingContent, Root as MdastRoot } from "mdast";
import { toString as mdToString } from "mdast-util-to-string";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeParse from "rehype-parse";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import type { PluggableList } from "unified";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import { rehypeFileRefs, type FileLinkOptions } from "./file-refs";
import { remarkSingleDollarMath } from "./math";

export type TocEntry = { depth: number; id: string; text: string };
export type Frontmatter = Record<string, unknown>;
/** `fileRefs` is what the link visitor already resolved: the changed files this document opens. */
export type Rendered = { html: string; toc: TocEntry[]; frontmatter: Frontmatter | null; fileRefs: readonly string[] };

/** A node remark-rehype turns into the element named by data.hName. */
type HNode = { type: string; data: { hName: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] }; children?: PhrasingContent[] };

const MARK = /==([^=\n]+)==/g;

/**
 * Doc-relative image references (`./x.png`, `sub/y.png`, `../z.png`) resolve against the app root
 * in the browser, not the file's folder, so they 404. When an assetBase is given (the local app
 * passes `/api/asset/<sessionId>`), rewrite every non-remote img src to that route. The relative
 * path rides as a query param: the browser never path-normalises a query string, so `../` refs
 * keep their doc-relative meaning (and 404 at the route if they escape the doc's folder).
 * Absolute http(s), data: and fragment srcs are left alone, so remote pictures and inlined
 * diagrams keep working and the cloud Worker (which passes no assetBase) renders as before.
 */
const EXTERNAL_SRC = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

function rehypeAssetImages(assetBase: string) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      if (el.tagName !== "img") return;
      const raw = el.properties?.src;
      if (typeof raw !== "string" || raw === "" || EXTERNAL_SRC.test(raw)) return;
      const rel = raw.replace(/^\/+/, "").replace(/^\.\//, "");
      el.properties.src = `${assetBase}?p=${encodeURIComponent(rel)}`;
    });
  };
}

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

const hasClass = (node: Element, name: string) => Array.isArray(node.properties.className) && node.properties.className.includes(name);

/** `$$…$$` alone in a paragraph is display math (Typora and Pandoc agree); remark-math reads it as inline. */
export function remarkDisplayMath() {
  return (tree: MdastRoot, file: { value: unknown }) => {
    const src = String(file.value);
    visit(tree, "paragraph", (node, index, parent) => {
      const only = node.children.length === 1 ? node.children[0] : undefined;
      if (!parent || index === undefined || only?.type !== "inlineMath" || !only.position) return;
      if (!src.startsWith("$$", only.position.start.offset ?? -1)) return;
      const code = el("code", { className: ["language-math", "math-display"] }, [txt(only.value)]);
      const block: HNode = { type: "math", value: only.value, position: node.position, data: { hName: "pre", hChildren: [code] } } as unknown as HNode;
      parent.children.splice(index, 1, block as never);
    });
  };
}

/** Heading text with the formulas dropped, so the TOC carries neither TeX source nor glyphs. */
function textWithoutMath(node: HastRoot | ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "root" || (node.type === "element" && !hasClass(node, "language-math"))) return (node.children as ElementContent[]).map((c) => textWithoutMath(c)).join("");
  return "";
}

/**
 * rehype-slug reads the heading text, which still holds the TeX source of its formulas when it
 * runs. Blank those formulas for the slug pass only, then put them back for KaTeX to render.
 */
function rehypeSlugOutsideMath() {
  const slug = rehypeSlug();
  return (tree: HastRoot) => {
    const held: { parent: Element; index: number; node: ElementContent }[] = [];
    visit(tree, "element", (heading: Element) => {
      if (!/^h[1-6]$/.test(heading.tagName)) return;
      visit(heading, "element", (node: Element, index, parent) => {
        if (!parent || index === undefined || !hasClass(node, "language-math")) return;
        const holder = parent as Element;
        held.push({ parent: holder, index, node: holder.children[index] });
        holder.children[index] = { type: "text", value: "" };
      });
    });
    slug(tree);
    for (const h of held) h.parent.children[h.index] = h.node;
  };
}

/** KaTeX's `.katex` root is the one element a formula contributes; it is opaque to the text map. */
function rehypeMathOpaque() {
  return (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      if (hasClass(el, "katex")) el.properties.dataTestid = "math";
    });
  };
}

function rehypeCollectToc(toc: TocEntry[]) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      const m = /^h([1-3])$/.exec(el.tagName);
      if (m && typeof el.properties.id === "string") toc.push({ depth: Number(m[1]), id: el.properties.id, text: textWithoutMath(el).replace(/\s+/g, " ").trim() });
    });
  };
}

/** Markdown to HTML on the server, so the text a comment anchors against is the same on every load. */
export async function renderMarkdown(src: string, opts?: { assetBase?: string; fileLinks?: FileLinkOptions }): Promise<Rendered> {
  const toc: TocEntry[] = [];
  const fm: { data: Frontmatter | null } = { data: null };
  const asset: PluggableList = opts?.assetBase ? [rehypeAssetImages(opts.assetBase)] : [];
  // One accumulator per render: the visitor records each reference as it rewrites the link, so the
  // Local PR list reuses this parse instead of scanning the markdown again.
  const fileRefs = new Set<string>();
  // With no snapshot the pipeline is byte-for-byte what CLI and cloud callers already get.
  const refs: PluggableList = opts?.fileLinks ? [[rehypeFileRefs, { ...opts.fileLinks, refs: fileRefs }]] : [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkFrontmatterTable(fm))
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkSingleDollarMath)
    .use(remarkDisplayMath)
    .use(remarkLegacyMarks)
    .use(remarkMermaidBlocks)
    .use(remarkRehype)
    .use(rehypeSlugOutsideMath)
    .use(rehypeCollectToc(toc))
    .use(asset)
    .use(refs)
    .use(rehypeKatex, { output: "html" })
    .use(rehypeMathOpaque)
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(rehypeStringify)
    .process(src);
  return { html: String(file), toc, frontmatter: fm.data, fileRefs: [...fileRefs].sort() };
}

/** Blocks the browser draws from their source; their text is not in the comment coordinate system. */
const OPAQUE = new Set(["mermaid", "math"]);

/** Text of a HAST tree in document order, skipping diagram and formula blocks (as buildTextMap does in the browser). */
function hastText(node: HastRoot | ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element" && OPAQUE.has(String(node.properties.dataTestid))) return "";
  if (node.type === "root" || node.type === "element") return node.children.map((c) => hastText(c as ElementContent)).join("");
  return "";
}

/**
 * The plain text a reader's browser sees for this doc: the coordinate system comment quotes live
 * in. Lets the CLI build a quote selector without a browser. Parsed back from the rendered HTML
 * so it matches what the HTML parser keeps.
 */
export async function renderPlainText(src: string): Promise<string> {
  const { html } = await renderMarkdown(src);
  const tree = unified().use(rehypeParse, { fragment: true }).parse(html);
  return hastText(tree);
}

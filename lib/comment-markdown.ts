/**
 * Comment and reply bodies as HTML, rendered on the server. A slim pipeline on purpose: it never
 * touches the filesystem (no assetBase, no docPath, no TOC, no mermaid), and it escapes raw HTML
 * to text, so a comment cannot inject markup or script.
 */
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { PluggableList } from "unified";
import type { Comment, Reply } from "./comments-store";
import { remarkDisplayMath } from "./markdown";
import { remarkSingleDollarMath } from "./math";

export type RenderedReply = Reply & { html: string };
export type RenderedComment = Omit<Comment, "replies"> & { html: string; replies: RenderedReply[] };

/** Only these schemes survive in a comment link; everything else keeps its text and loses the href. */
const SAFE_URL = /^(?:https?:|mailto:)/i;

/** Raw HTML is shown as text, never parsed as markup. */
function remarkHtmlAsText() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "html", (node: { type: string }) => {
      node.type = "text";
    });
  };
}

/** A link whose target is not an allowed scheme becomes its own text. */
function remarkSafeLinks() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "link", (node: { url: string; children: unknown[] }, index: number | undefined, parent: { children: unknown[] } | undefined) => {
      if (!parent || index === undefined || SAFE_URL.test(node.url.trim())) return;
      parent.children.splice(index, 1, ...node.children);
      return index;
    });
  };
}

/** An image in a comment becomes its alt text: comments never fetch pictures. */
function remarkImagesAsText() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "image", (node: { alt?: string | null }, index: number | undefined, parent: { children: unknown[] } | undefined) => {
      if (!parent || index === undefined) return;
      parent.children.splice(index, 1, { type: "text", value: node.alt || "image" });
      return index + 1;
    });
  };
}

/** A newline inside a paragraph is a line break, as the author typed it. */
function remarkLineBreaks() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "text", (node: { value: string }, index: number | undefined, parent: { children: unknown[] } | undefined) => {
      if (!parent || index === undefined || !node.value.includes("\n")) return;
      const nodes: { type: string; value?: string }[] = [];
      node.value.split("\n").forEach((part, i) => {
        if (i > 0) nodes.push({ type: "break" });
        if (part) nodes.push({ type: "text", value: part });
      });
      parent.children.splice(index, 1, ...nodes);
      return index + nodes.length;
    });
  };
}

/** Every link opens in a new tab without giving the target a handle back to this page. */
function rehypeLinkSafety() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "element", (el: { tagName: string; properties: Record<string, unknown> }) => {
      if (el.tagName !== "a") return;
      el.properties.target = "_blank";
      el.properties.rel = "noopener noreferrer";
    });
  };
}

/**
 * Four processors, because the expensive plugins should only run on a body that can use them: most
 * comments are one plain paragraph, and running KaTeX + highlight.js over those was the whole cost of
 * the first version (23.9 ms for 20 comments). Each is built once and frozen.
 */
function build(withMath: boolean, withCode: boolean) {
  const plugins: PluggableList = [remarkParse, remarkGfm];
  if (withMath) plugins.push([remarkMath, { singleDollarTextMath: false }], remarkSingleDollarMath, remarkDisplayMath);
  plugins.push(remarkHtmlAsText, remarkSafeLinks, remarkImagesAsText, remarkLineBreaks, remarkRehype, rehypeLinkSafety);
  if (withMath) plugins.push([rehypeKatex, { output: "html" }]);
  if (withCode) plugins.push([rehypeHighlight, { detect: false, ignoreMissing: true }]);
  plugins.push(rehypeStringify);
  return unified().use(plugins).freeze();
}

const PLAIN = build(false, false);
const MATH = build(true, false);
const CODE = build(false, true);
const MATH_CODE = build(true, true);

/** Bodies that cannot contain math or a fence skip those plugins entirely. */
const hasMath = (src: string) => src.includes("$");
const hasFence = (src: string) => src.includes("```") || src.includes("~~~");

/**
 * Rendered bodies, keyed by the body text (not the id: the same sentence in two comments is one
 * render) and kept across requests. A comment body never changes without its text changing, so the
 * cache cannot go stale; it is bounded so a long session cannot grow it without limit.
 */
const rendered = new Map<string, string>();
const CACHE_LIMIT = 500;

/** HTML for one comment or reply body. Synchronous CPU work only; no file is read. */
export function renderCommentBody(src: string): string {
  const hit = rendered.get(src);
  if (hit !== undefined) return hit;
  const p = hasMath(src) ? (hasFence(src) ? MATH_CODE : MATH) : hasFence(src) ? CODE : PLAIN;
  const out = String(p.processSync(src));
  if (rendered.size >= CACHE_LIMIT) rendered.delete(rendered.keys().next().value as string);
  rendered.set(src, out);
  return out;
}

/**
 * Every comment in a response with its replies rendered. Each body renders once per request: the
 * cache is keyed by comment or reply id and lives only as long as this call.
 */
export function renderComments(list: Comment[]): RenderedComment[] {
  const cache = new Map<string, string>();
  const html = (id: string, body: string) => {
    let out = cache.get(id);
    if (out === undefined) {
      out = renderCommentBody(body);
      cache.set(id, out);
    }
    return out;
  };
  return list.map((c) => ({
    ...c,
    html: html(c.id, c.body),
    replies: c.replies.map((r) => ({ ...r, html: html(r.id, r.body) })),
  }));
}

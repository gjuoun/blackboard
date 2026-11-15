import { createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import { toString as mdastToString } from "mdast-util-to-string";

/**
 * Markdown → paragraph-level content blocks, the unit comments anchor to and diffs diff.
 * A block is one top-level mdast child; a list is split further into one block per item (a
 * twenty-item list otherwise reads as one change when a single item is rewritten). Pure: no
 * database, no Effect, no filesystem.
 */

export type BlockSpec = {
  kind: string;
  /** Raw markdown slice. */
  text: string;
  /** Rendered text (no markdown marks): the text quote selectors match against. */
  plain: string;
  /** sha of the normalised raw text. */
  hash: string;
  /** The top-level group this block belongs to (a list's items share the parent's group). */
  grp: number;
};

const proc = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkMath);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
export const blockHash = (s: string) => createHash("sha1").update(norm(s)).digest("hex").slice(0, 12);

const spec = (src: string, node: { position: { start: { offset?: number }; end: { offset?: number } }; type: string }, grp: number, plain?: string): BlockSpec => {
  const text = src.slice(node.position.start.offset, node.position.end.offset);
  return { kind: node.type, text, plain: (plain ?? mdastToString(node)).replace(/\s+$/, ""), hash: blockHash(text), grp };
};

/** Top-level blocks of `src`, in document order. */
export function parseContentBlocks(src: string): BlockSpec[] {
  const tree = proc.parse(src) as unknown as { children?: { type: string; children?: unknown[]; position: never }[] };
  const out: BlockSpec[] = [];
  let grp = 0;
  for (const node of tree.children ?? []) {
    const g = grp++;
    if (node.type === "list") {
      for (const item of (node.children ?? []) as never[]) {
        out.push(spec(src, { ...(item as object), type: "listItem" } as never, g));
      }
      continue;
    }
    out.push(spec(src, node as never, g));
  }
  return out;
}

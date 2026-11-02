/**
 * A source file as the markdown the page renders. The file text goes into one fenced block, so the
 * existing renderer does the escaping and the highlighting, and nothing inside the file is read as
 * markdown. The fence is one backtick longer than the longest run in the file, so a fence inside the
 * file cannot close the block early.
 */
import { extOf } from "./doc-type";
import { renderMarkdown, type Rendered } from "./markdown";

/** Fence language per extension. Unknown extensions get no language, so nothing is guessed. */
const LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", json: "json", css: "css",
  sh: "bash", py: "python", go: "go", rs: "rust", yml: "yaml", toml: "toml",
};

export function codeMarkdown(src: string, path: string): string {
  const longest = Math.max(2, ...[...src.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const lang = LANG[extOf(path)] ?? "";
  return [fence + lang, src.replace(/\n$/, ""), fence, ""].join("\n");
}

/** HTML for a code file: the highlighted block, wrapped so the CSS can unwrap it. */
export async function renderCode(src: string, path: string): Promise<Rendered> {
  const out = await renderMarkdown(codeMarkdown(src, path));
  return { ...out, html: `<div class="code-file">${out.html}</div>` };
}

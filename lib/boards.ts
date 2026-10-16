import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveSafe } from "./paths";

export type Board = { name: string; docCount: number; updatedAt: number };

const SKIP = new Set(["node_modules"]);
const visible = (name: string) => !name.startsWith(".") && !SKIP.has(name);

/** Every first-level, non-hidden folder under the root is a board. */
export function listBoards(root: string): Board[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && visible(e.name))
    .map((e) => {
      const dir = join(root, e.name);
      return { name: e.name, docCount: listDocs(dir).length, updatedAt: statSync(dir).mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Markdown files in a board, as board-relative paths with "/" separators. Root files come
 * before sub-folders. Hidden folders, node_modules and symlinks that leave the board are skipped.
 */
export function listDocs(boardDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries;
    try {
      entries = readdirSync(join(boardDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    const files: string[] = [];
    const dirs: string[] = [];
    for (const e of entries) {
      if (!visible(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const real = resolveSafe(boardDir, childRel);
      if (!real) continue;
      const st = statSync(real);
      if (st.isDirectory()) dirs.push(childRel);
      else if (st.isFile() && e.name.toLowerCase().endsWith(".md")) files.push(childRel);
    }
    out.push(...files.sort());
    for (const d of dirs.sort()) walk(d);
  };
  walk("");
  return out;
}

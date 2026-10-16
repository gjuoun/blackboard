import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export type DocRepo = { name: string; root: string; relPath: string };
export type DocStats = { sections: number; diagrams: number };
export type DocMeta = {
  title: string;
  /** The git repo the file is in, or null outside git. */
  repo: DocRepo | null;
  /** Current branch, the short sha when detached, null outside git. */
  branch: string | null;
  /** The newer of the doc's and its comment file's mtime, ISO; null when the doc is gone. */
  updatedAt: string | null;
  missing: boolean;
  stats: DocStats;
};

const GIT_TIMEOUT_MS = 2000;

/** One git answer, or null when git fails, is missing, or takes longer than 2 s. */
function git(cwd: string, ...args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Split off a leading YAML front matter block. */
function splitFrontMatter(src: string): { fm: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  return m ? { fm: m[1], body: src.slice(m[0].length) } : { fm: null, body: src };
}

/** Lines of the body that are outside fenced code blocks, plus the info string of each fence opened outside one. */
function scan(body: string): { lines: string[]; fences: string[] } {
  const lines: string[] = [];
  const fences: string[] = [];
  let open: { ch: string; len: number } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (f && f[1][0] === open.ch && f[1].length >= open.len && !f[2].trim()) open = null;
      continue;
    }
    if (f) {
      open = { ch: f[1][0], len: f[1].length };
      fences.push(f[2].trim());
      continue;
    }
    lines.push(line);
  }
  return { lines, fences };
}

/** Front matter `title`, else the first `# ` heading, else the file name. */
export function docTitle(src: string, path: string): string {
  const { fm, body } = splitFrontMatter(src);
  if (fm) {
    try {
      const data = parseYaml(fm);
      if (data && typeof data === "object" && typeof data.title === "string" && data.title.trim()) return data.title.trim();
    } catch {
      // unparsable front matter: fall through
    }
  }
  for (const line of scan(body).lines) {
    const h = /^ {0,3}#[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (h) return h[1];
  }
  return basename(path);
}

/** `##` sections and mermaid diagrams — the scratchpad card's summary. */
export function docStats(src: string): DocStats {
  const { lines, fences } = scan(splitFrontMatter(src).body);
  return {
    sections: lines.filter((l) => /^ {0,3}##[ \t]+\S/.test(l)).length,
    diagrams: fences.filter((info) => info.split(/\s+/)[0] === "mermaid").length,
  };
}

const mtime = (p: string | undefined) => {
  try {
    return p ? statSync(p).mtimeMs : 0;
  } catch {
    return 0;
  }
};

/** What Home and the doc header show for one file: title, where it is, which branch. */
export function docMeta(path: string, commentsFile?: string): DocMeta {
  if (!existsSync(path)) {
    return { title: basename(path), repo: null, branch: null, updatedAt: null, missing: true, stats: { sections: 0, diagrams: 0 } };
  }
  const src = readFileSync(path, "utf8");
  const dir = dirname(path);
  const top = git(dir, "rev-parse", "--show-toplevel");
  let repo: DocRepo | null = null;
  let branch: string | null = null;
  if (top) {
    const root = realpathSync(top);
    repo = { name: basename(root), root, relPath: relative(root, path).split("\\").join("/") };
    branch = git(dir, "branch", "--show-current") ?? git(dir, "rev-parse", "--short", "HEAD");
  }
  const updated = Math.max(mtime(path), mtime(commentsFile));
  return { title: docTitle(src, path), repo, branch, updatedAt: new Date(updated).toISOString(), missing: false, stats: docStats(src) };
}

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type DocRepo = { name: string; root: string; relPath: string };
export type DocWorktree = { name: string; path: string };
/** The main checkout a file belongs to: the repo a linked worktree was created from, or the repo itself. */
export type DocProject = { name: string; root: string };
export type DocStats = { sections: number; diagrams: number };
export type DocMeta = {
  title: string;
  /** The git repo the file is in, or null outside git. */
  repo: DocRepo | null;
  /** Current branch, the short sha when detached, null outside git. */
  branch: string | null;
  /** True when HEAD is detached, so `branch` is a short sha. */
  detached: boolean;
  /** The linked worktree the file is in; null for the main checkout and outside git. */
  worktree: DocWorktree | null;
  /** The main checkout's name and root, the same for a worktree and its main checkout; null outside git. */
  project: DocProject | null;
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

/** The real path of the git repo root holding `dir`, or null outside git. */
export function repoRoot(dir: string): string | null {
  const top = git(dir, "rev-parse", "--show-toplevel");
  return top ? realpathSync(/*turbopackIgnore: true*/ top) : null;
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

/**
 * The linked worktree holding `dir`, or null. In the main checkout `--git-dir` and
 * `--git-common-dir` are the same directory; in a linked worktree the first is `.git/worktrees/<name>`.
 */
function linkedWorktree(dir: string, root: string): DocWorktree | null {
  const gitDir = git(dir, "rev-parse", "--git-dir");
  const common = git(dir, "rev-parse", "--git-common-dir");
  if (!gitDir || !common) return null;
  // git prints these relative to `dir` when it can; resolve before comparing.
  if (realpathSync(resolve(dir, gitDir)) === realpathSync(resolve(dir, common))) return null;
  return { name: basename(root), path: root };
}

/**
 * The main checkout's root. `--git-common-dir` is the shared `.git` directory, which sits in the main
 * checkout's root; from a linked worktree it still points there. Falls back to `root` for an unusual layout.
 */
function mainCheckoutRoot(dir: string, root: string): string {
  const common = git(dir, "rev-parse", "--git-common-dir");
  if (!common) return root;
  const abs = realpathSync(resolve(dir, common));
  return basename(abs) === ".git" ? dirname(abs) : root;
}

/** What Home and the doc header show for one file: title, where it is, which branch. */
export function docMeta(path: string, commentsFile?: string): DocMeta {
  if (!existsSync(path)) {
    return { title: basename(path), repo: null, branch: null, detached: false, worktree: null, project: null, updatedAt: null, missing: true, stats: { sections: 0, diagrams: 0 } };
  }
  const src = readFileSync(path, "utf8");
  const dir = dirname(path);
  const top = git(dir, "rev-parse", "--show-toplevel");
  let repo: DocRepo | null = null;
  let branch: string | null = null;
  let detached = false;
  let worktree: DocWorktree | null = null;
  let project: DocProject | null = null;
  if (top) {
    // Docs live anywhere on disk by design; keep the build from tracing the whole project.
    const root = realpathSync(/*turbopackIgnore: true*/ top);
    repo = { name: basename(root), root, relPath: relative(root, path).split("\\").join("/") };
    const current = git(dir, "branch", "--show-current");
    detached = current === null;
    branch = current ?? git(dir, "rev-parse", "--short", "HEAD");
    worktree = linkedWorktree(dir, root);
    const mainRoot = mainCheckoutRoot(dir, root);
    project = { name: basename(mainRoot), root: mainRoot };
  }
  const updated = Math.max(mtime(path), mtime(commentsFile));
  return { title: docTitle(src, path), repo, branch, detached, worktree, project, updatedAt: new Date(updated).toISOString(), missing: false, stats: docStats(src) };
}

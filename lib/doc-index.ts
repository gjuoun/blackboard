import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { docStats, docTitle } from "./doc-meta";

/**
 * Everything the database keeps about one document, computed from its file and its checkout. Pure apart from
 * reading the file and asking git, and both happen once per document per index run, never per request.
 */
export type DocFacts = {
  title: string;
  body: string;
  sections: number;
  diagrams: number;
  branch: string | null;
  detached: boolean;
  repoName: string | null;
  repoRoot: string | null;
  relPath: string | null;
  worktreeName: string | null;
  worktreePath: string | null;
  projectName: string | null;
  projectRoot: string | null;
  srcMtime: number;
  srcSize: number;
};

const GIT_TIMEOUT_MS = 2000;

/** One git answer, or null. The one place this module runs git. */
function git(cwd: string, ...args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/** A repository as git describes it for one run: the top, the names, and the branch. Keyed by the directory asked. */
export type RepoFacts = Pick<DocFacts, "branch" | "detached" | "repoName" | "repoRoot" | "worktreeName" | "worktreePath" | "projectName" | "projectRoot"> & { top: string | null };

/**
 * The checkout facts for a directory. Memoised only inside one `RepoMemo`, so one index run asks git once per work
 * tree; the memo is dropped when the run ends. Nothing carries over to a request.
 */
export class RepoMemo {
  private byDir = new Map<string, RepoFacts>();
  private byTop = new Map<string, RepoFacts>();
  /** git commands run through this memo: the number a test counts. */
  calls = 0;

  facts(dir: string): RepoFacts {
    const held = this.byDir.get(dir);
    if (held) return held;
    const top = this.findTop(dir);
    if (top === null) {
      const outside: RepoFacts = { top: null, branch: null, detached: false, repoName: null, repoRoot: null, worktreeName: null, worktreePath: null, projectName: null, projectRoot: null };
      this.byDir.set(dir, outside);
      return outside;
    }
    const byTop = this.byTop.get(top);
    if (byTop) {
      this.byDir.set(dir, byTop);
      return byTop;
    }
    const fresh = this.describe(top);
    this.byTop.set(top, fresh);
    this.byDir.set(dir, fresh);
    return fresh;
  }

  /** The nearest ancestor holding a `.git` entry. No child process: a stat per level. */
  private findTop(start: string): string | null {
    if (!existsSync(start)) return null;
    let d = realpathSync(start);
    for (;;) {
      if (existsSync(join(d, ".git"))) return d;
      const up = dirname(d);
      if (up === d) return null;
      d = up;
    }
  }

  /** One work tree: the git commands that give its branch, its linked-worktree status, and its main checkout. */
  private describe(top: string): RepoFacts {
    this.calls += 1;
    const dirs = git(top, "rev-parse", "--git-dir", "--git-common-dir");
    this.calls += 1;
    const current = git(top, "branch", "--show-current");
    const [gitDirRaw, commonRaw] = (dirs ?? "").split("\n");
    const branch = current ?? (this.calls++, git(top, "rev-parse", "--short", "HEAD"));
    const root = realpathSync(top);
    const gitDir = gitDirRaw ? realpathSync(resolve(top, gitDirRaw)) : null;
    const common = commonRaw ? realpathSync(resolve(top, commonRaw)) : null;
    const linked = gitDir !== null && common !== null && gitDir !== common;
    const mainRoot = common !== null && common.slice(common.lastIndexOf("/") + 1) === ".git" ? resolve(common, "..") : root;
    return {
      top: root,
      branch,
      detached: current === null,
      repoName: basename(root),
      repoRoot: root,
      worktreeName: linked ? basename(root) : null,
      worktreePath: linked ? root : null,
      projectName: basename(mainRoot),
      projectRoot: mainRoot,
    };
  }
}

/**
 * Everything the index keeps for one file. `memo` is shared across one run, so a directory of documents costs one set
 * of git commands, not one per document.
 */
export function factsOf(path: string, memo: RepoMemo): DocFacts {
  const src = readFileSync(path, "utf8");
  const st = statSync(path);
  const repo = memo.facts(dirname(path));
  const inRepo = repo.top !== null;
  const rel = inRepo ? relative(repo.top!, path).split("\\").join("/") : null;
  const stats = docStats(src);
  return {
    title: docTitle(src, path),
    body: src,
    sections: stats.sections,
    diagrams: stats.diagrams,
    branch: repo.branch,
    detached: repo.detached,
    repoName: repo.repoName,
    repoRoot: repo.repoRoot,
    relPath: rel,
    worktreeName: repo.worktreeName,
    worktreePath: repo.worktreePath,
    projectName: repo.projectName,
    projectRoot: repo.projectRoot,
    srcMtime: Math.floor(st.mtimeMs),
    srcSize: st.size,
  };
}

export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

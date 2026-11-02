import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DESIGN = "# Design\n\nThe cache is warm. Later text. The cache is warm. End.\n";
export const BIN = new URL("../../bin/blackboard.ts", import.meta.url).pathname;

/** A temp home and a docs folder outside any git repo. */
export function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-cli-")));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(docs, { recursive: true });
  const design = join(docs, "design.md");
  writeFileSync(design, DESIGN);
  writeFileSync(join(docs, "other.md"), "# Other\n");
  return { base, home, docs, design };
}

/** A temp home and a git repo with one source file and one registered doc. */
export function repoSetup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-cli-repo-")));
  const home = join(base, "home");
  const repo = join(base, "repo");
  mkdirSync(join(repo, "lib"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  const source = join(repo, "lib", "residency.ts");
  writeFileSync(source, "export function residency() {\n  const gate = 1;\n  return gate;\n}\n");
  const design = join(repo, "docs", "review.md");
  writeFileSync(design, "# Review\n\nA doc.\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@e", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "fixture");
  return { home, repo, source, design };
}

/** The real binary, the way a shell runs it. */
export const runCli = (home: string, args: string[], cwd?: string) => {
  const p = Bun.spawnSync(["bun", BIN, "--home", home, ...args], { cwd, env: { ...process.env, BLACKBOARD_NO_BROWSER: "1" } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
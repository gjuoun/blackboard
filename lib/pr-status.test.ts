import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../test/app";
import { formatPr } from "./cli";
import { comment } from "./cli/comments";
import { open, pr } from "./cli/sessions";
import { prStatus } from "./pr-status";

const BIN = new URL("../bin/blackboard.ts", import.meta.url).pathname;

/** A temp home and a git repo whose doc is opened as a pr session with one open comment. */
async function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-pr-status-")));
  const home = join(base, "home");
  const repo = join(base, "repo");
  mkdirSync(join(repo, "lib"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "lib", "a.ts"), "export const a = 1;\n");
  const doc = join(repo, "docs", "review.md");
  writeFileSync(doc, "# Review\n\nA line to comment on.\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-qb", "feat/x");
  writeFileSync(join(repo, "lib", "a.ts"), "export const a = 2;\n");
  const { session } = await run(open(home, doc, repo, "pr"));
  await run(comment(home, doc, "A line to comment on.", "please explain", "jun"));
  return { home, repo, doc, id: session.id };
}

const runBin = (home: string, args: string[], cwd: string) => {
  const p = Bun.spawnSync(["bun", BIN, "--home", home, "--no-server", "--no-browser", ...args], { cwd, env: { ...process.env, BLACKBOARD_NO_BROWSER: "1" } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

describe("pr status", () => {
  test("the payload carries the front matter, the pin, the command, files and open comments", async () => {
    const { home, id } = await setup();
    const status = await run(pr(home, id));
    expect(status.kind).toBe("pr");
    expect(status.frontmatter?.kind).toBe("pr");
    expect(status.base?.ref).toBe("main");
    expect(status.base?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(status.command).toContain("git -C");
    expect(status.command).toContain(status.base!.sha);
    expect(status.files.some((f) => f.path === "lib/a.ts")).toBe(true);
    expect(status.totals?.files).toBe(status.files.length);
    expect(status.comments.open).toBe(1);
    expect(formatPr(status)).toContain(status.command!);
  });

  test("an unknown ref is null; the binary reports it as a failed command", async () => {
    const { home, repo } = await setup();
    expect(await run(prStatus(home, "0000000000"))).toBeNull();
    const missing = runBin(home, ["pr", "0000000000"], repo);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no session");
  }, 30_000);

  test("--json is the payload, and its command runs verbatim", async () => {
    const { home, repo, id } = await setup();
    const printed = runBin(home, ["pr", id, "--json"], repo);
    expect(printed.code).toBe(0);
    const payload = JSON.parse(printed.out);
    expect(payload).toEqual(JSON.parse(JSON.stringify(await run(pr(home, id)))));
    const out = execFileSync("bash", ["-lc", payload.command], { cwd: tmpdir() }).toString();
    expect(out).toContain("lib/a.ts");
    const human = runBin(home, ["pr", id], repo);
    expect(human.code).toBe(0);
    expect(human.out).toContain("base main @");
  }, 30_000);
});

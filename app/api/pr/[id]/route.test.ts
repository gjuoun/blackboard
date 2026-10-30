import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "@/lib/cli";
import { prStatus } from "@/lib/pr-status";
import { GET } from "./route";

/** A temp home and a git repo with one changed file and a pr doc. */
function setup(kind: "pr" | "plain") {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-pr-route-")));
  const home = join(base, "home");
  const repo = join(base, "repo");
  mkdirSync(join(repo, "lib"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "lib", "a.ts"), "export const a = 1;\n");
  const doc = join(repo, "docs", "review.md");
  writeFileSync(doc, "# Review\n\nA [range](file:lib/a.ts:L1).\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-qb", "feat/x");
  writeFileSync(join(repo, "lib", "a.ts"), "export const a = 2;\n");
  process.env.BLACKBOARD_HOME = home;
  const { session } = open(home, doc, process.cwd(), kind);
  return { home, repo, doc, session: session.id };
}

const get = (id: string) => GET(new Request("http://127.0.0.1/api/pr/" + id), { params: Promise.resolve({ id }) });

describe("pr API", () => {
  test("a pr session answers the same payload the builder and CLI use", async () => {
    const { home, session } = setup("pr");
    const res = await get(session);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(prStatus(home, session)!);
    expect(body.kind).toBe("pr");
    expect(body.base.ref).toBe("main");
    expect(body.base.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.command).toContain(body.base.sha);
    // The fill rewrote the doc itself, so the doc and the source file are both changed.
    expect(body.files.map((f: { path: string }) => f.path).sort()).toEqual(["docs/review.md", "lib/a.ts"]);
    expect(body.files.find((f: { path: string }) => f.path === "lib/a.ts")).toEqual({ path: "lib/a.ts", status: "modified", additions: 1, deletions: 1, binary: false });
    expect(body.totals.files).toBe(2);
    expect(body.totals.additions).toBeGreaterThan(0);
    expect(body.comments).toEqual({ open: 0 });
    expect(body.frontmatter).toMatchObject({ kind: "pr", pr: { base: "main" } });
  });

  test("a plain session is honest: no base, no command", async () => {
    const { home, session } = setup("plain");
    const body = await (await get(session)).json();
    expect(body.kind).toBe("plain");
    expect(body.base).toBeNull();
    expect(body.command).toBeNull();
    expect(body.files).toEqual([]);
    expect(prStatus(home, session)!.kind).toBe("plain");
  });

  test("an unknown session is a 404", async () => {
    setup("pr");
    const res = await get("0000000000");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });
});

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffCommand, ensurePrDoc, fillPrFrontmatter, parsePrFrontmatter, resolveBase, resolveSha, shellQuote, splitFrontmatter } from "./pr-kind";

const SHA = "9675990d1e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b";

describe("front matter", () => {
  test("a doc without a block is plain", () => {
    const doc = parsePrFrontmatter("# Review\n\ntext\n");
    expect(doc.kind).toBe("plain");
    expect(doc.frontmatter).toBeNull();
    expect(doc.base).toBeNull();
  });

  test("kind pr with a nested pr map carries the base and the sha", () => {
    const doc = parsePrFrontmatter(["---", "kind: pr", "title: Review", "pr:", "  base: main", "  base_sha: " + SHA, "---", "", "# Review"].join("\n"));
    expect(doc.kind).toBe("pr");
    expect(doc.base).toBe("main");
    expect(doc.baseSha).toBe(SHA);
    expect(doc.frontmatter?.title).toBe("Review");
  });

  test("a sha that is not a hash is not a pin", () => {
    expect(parsePrFrontmatter("---\nkind: pr\npr:\n  base_sha: not-a-hash\n---\n").baseSha).toBeNull();
    expect(parsePrFrontmatter("---\nkind: pr\npr:\n  base_sha: " + SHA.toUpperCase() + "\n---\n").baseSha).toBe(SHA);
  });

  test("kind is only pr for the literal value", () => {
    expect(parsePrFrontmatter("---\nkind: PR\n---\n").kind).toBe("plain");
    expect(parsePrFrontmatter("---\nkind: review\n---\n").kind).toBe("plain");
  });
});

describe("fill", () => {
  test("a doc with no front matter gains the whole block", () => {
    const out = fillPrFrontmatter("# Review\n", { base: "main", sha: SHA });
    expect(out).toBe(["---", "kind: pr", "pr:", "  base: main", "  base_sha: " + SHA, "---", "", "# Review", ""].join("\n"));
    expect(parsePrFrontmatter(out).baseSha).toBe(SHA);
  });

  test("unrelated fields keep their bytes", () => {
    const src = ["---", "title: Review", "tags:", "  - one", "  - two", "owner:", "  name: jun", "---", "", "# Review", ""].join("\n");
    const out = fillPrFrontmatter(src, { base: "main", sha: SHA });
    expect(out).toContain("tags:\n  - one\n  - two");
    expect(out).toContain("owner:\n  name: jun");
    expect(splitFrontmatter(out)!.yaml.split("\n")[0]).toBe("kind: pr");
  });

  test("a pr block with only a base gains the sha in place", () => {
    const src = ["---", "kind: pr", "pr:", "  base: release", "---", "", "Body", ""].join("\n");
    const out = fillPrFrontmatter(src, { base: "release", sha: SHA });
    expect(out).toContain(["pr:", "  base: release", "  base_sha: " + SHA].join("\n"));
    expect(out).toContain("Body");
  });

  test("a second fill with the same values is byte-stable", () => {
    const once = fillPrFrontmatter("---\ntitle: T\n---\n\nBody\n", { base: "main", sha: SHA });
    expect(fillPrFrontmatter(once, { base: "main", sha: SHA })).toBe(once);
  });

  test("a wrong kind is corrected", () => {
    const out = fillPrFrontmatter("---\nkind: plain\n---\n\nBody\n", { base: "main", sha: SHA });
    expect(out).toContain("kind: pr");
    expect(out).not.toContain("kind: plain");
  });

  test("the body is untouched and CRLF survives", () => {
    const src = "---\r\ntitle: T\r\n---\r\n\r\n# Body\r\n";
    const out = fillPrFrontmatter(src, { base: "main", sha: SHA });
    expect(out.includes("\r\n")).toBe(true);
    expect(out.endsWith("# Body\r\n")).toBe(true);
  });
});

describe("git seams", () => {
  test("the merge-base wins over the branch tip", () => {
    const calls: string[][] = [];
    const base = "1111111111111111111111111111111111111111";
    const git = (cwd: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "rev-parse" && args.at(-1) === "origin/main") return "2222222222222222222222222222222222222222\n";
      if (args[0] === "rev-parse" && args.at(-1) === "main") return null;
      if (args[0] === "rev-parse" && args.at(-1) === "HEAD") return "3333333333333333333333333333333333333333\n";
      if (args[0] === "merge-base") return base + "\n";
      return null;
    };
    expect(resolveBase("/repo", git)).toEqual({ ref: "main", sha: base });
    expect(calls.some((c) => c[0] === "merge-base")).toBe(true);
  });

  test("no main branch means no base", () => {
    expect(resolveBase("/repo", () => null)).toBeNull();
  });

  test("a sha resolves to the full commit or null", () => {
    const git = (_cwd: string, args: string[]) => (args.includes("deadbeef^{commit}") ? null : SHA + "\n");
    expect(resolveSha("/repo", "deadbeef", git)).toBeNull();
    expect(resolveSha("/repo", SHA.slice(0, 7), git)).toBe(SHA);
  });

  test("ensure keeps a valid pin and reports no fill", () => {
    const src = "---\nkind: pr\npr:\n  base: main\n  base_sha: " + SHA.slice(0, 7) + "\n---\n\nBody\n";
    const out = ensurePrDoc(src, "/repo", (_cwd, args) => (args.includes(SHA.slice(0, 7) + "^{commit}") ? SHA + "\n" : null));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.filled).toBe(false);
    expect(out.sha).toBe(SHA);
    expect(out.src).toContain("  base_sha: " + SHA);
  });

  test("ensure refuses an unresolvable pin instead of floating", () => {
    const src = "---\nkind: pr\npr:\n  base: main\n  base_sha: deadbeef\n---\n";
    const out = ensurePrDoc(src, "/repo", () => null);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("deadbeef");
  });
});

describe("command", () => {
  test("the quoted path and sha stay one shell word each", () => {
    const cmd = diffCommand("/tmp/a repo/it's", SHA);
    expect(cmd).toBe("git -C " + shellQuote("/tmp/a repo/it's") + " diff --no-color --no-ext-diff --unified=3 -M '" + SHA + "' -- .");
    const words = execFileSync("bash", ["-c", "printf '%s\\n' " + cmd.split(" ").slice(0, 4).join(" ")]).toString();
    expect(words.split("\n")[2]).toBe("/tmp/a repo/it's");
  });
});

describe("against a real repository", () => {
  test("the base is the merge-base of main, not the branch tip", () => {
    const root = join(realpathSync(mkdtempSync(join(tmpdir(), "bb-pr-kind-"))), "repo");
    mkdirSync(join(root, "docs"), { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    writeFileSync(join(root, "docs", "a.md"), "# A\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "one");
    const base = git("rev-parse", "HEAD").toString().trim();
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-qb", "feat/x");
    writeFileSync(join(root, "docs", "a.md"), "# A\n\nmore\n");
    git("commit", "-qam", "two");
    expect(resolveBase(root)).toEqual({ ref: "main", sha: base });
    expect(resolveSha(root, base)?.trim()).toBe(base);
    expect(resolveSha(root, "deadbeef")).toBeNull();
  });
});

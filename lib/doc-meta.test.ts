import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docMeta, docStats, docTitle } from "./doc-meta";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-meta-")));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stdio: "ignore" });

function repo() {
  const root = join(tmp(), "my-repo");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "plan.md"), "# Plan\n\n## One\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n## Two\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "checkout", "-qb", "feat/x");
  return root;
}

describe("docTitle", () => {
  test("front matter title wins over heading", () => {
    expect(docTitle("---\ntitle: From FM\n---\n\n# Heading\n", "a.md")).toBe("From FM");
  });

  test("first # heading, skipping code fences and front matter", () => {
    expect(docTitle("---\nstatus: x\n---\n\n```sh\n# not a title\n```\n\n## Sub\n\n# Real Title\n", "a.md")).toBe("Real Title");
  });

  test("falls back to the file name", () => {
    expect(docTitle("no heading here\n", "/x/notes.md")).toBe("notes.md");
    expect(docTitle("---\ntitle: [unclosed\n---\n", "/x/bad.md")).toBe("bad.md");
  });
});

describe("docStats", () => {
  test("counts ## sections and mermaid diagrams outside code fences", () => {
    const src = "# T\n\n## A\n\n```mermaid\ngraph\n```\n\n````md\n## not a section\n```mermaid\n```\n````\n\n## B\n\n```mermaid\ngraph\n```\n";
    expect(docStats(src)).toEqual({ sections: 2, diagrams: 2 });
  });
});

describe("docMeta", () => {
  test("branch of a git doc", () => {
    const root = repo();
    const m = docMeta(join(root, "docs", "plan.md"));
    expect(m.title).toBe("Plan");
    expect(m.repo).toEqual({ name: "my-repo", root, relPath: "docs/plan.md" });
    expect(m.branch).toBe("feat/x");
    expect(m.missing).toBe(false);
    expect(m.stats).toEqual({ sections: 2, diagrams: 1 });
  });

  test("detached head shows short sha", () => {
    const root = repo();
    git(root, "checkout", "-q", "--detach");
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
    expect(docMeta(join(root, "docs", "plan.md")).branch).toBe(sha);
  });

  test("outside git has no repo", () => {
    const dir = tmp();
    writeFileSync(join(dir, "loose.md"), "# Loose\n");
    const m = docMeta(join(dir, "loose.md"));
    expect(m.repo).toBeNull();
    expect(m.branch).toBeNull();
    expect(m.title).toBe("Loose");
  });

  test("missing file is flagged", () => {
    const dir = tmp();
    writeFileSync(join(dir, "gone.md"), "# Gone\n");
    rmSync(join(dir, "gone.md"));
    const m = docMeta(join(dir, "gone.md"));
    expect(m).toMatchObject({ missing: true, title: "gone.md", updatedAt: null });
  });

  test("updated is the newer of the doc and its comment file", () => {
    const dir = tmp();
    const doc = join(dir, "a.md");
    const comments = join(dir, "comments.json");
    writeFileSync(doc, "# A\n");
    writeFileSync(comments, "{}");
    utimesSync(doc, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    utimesSync(comments, new Date("2026-02-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    expect(docMeta(doc, comments).updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(docMeta(doc, join(dir, "none.json")).updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

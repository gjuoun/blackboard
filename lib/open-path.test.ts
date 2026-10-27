import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseOpener, containedIn, docRoots, openPath, parsePathRef, realFile, registeredRoots, resolveDocPath, type DocRoots } from "./open-path";

/**
 * A git repo at base/repo with docs/ (the doc lives in docs/deep/), a file beside the repo root, a
 * symlink out of the repo, and a non-git folder at base/notes. Real files, real git.
 */
let base = "";
const saved = { HOME: process.env.HOME, EDITOR: process.env.BLACKBOARD_EDITOR };

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "bb-open-path-")));
  const repo = join(base, "repo");
  mkdirSync(join(repo, "docs", "deep"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(base, "notes"));
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "docs", "deep", "doc.md"), "# doc\n");
  writeFileSync(join(repo, "docs", "local.ts"), "export {};\n");
  writeFileSync(join(repo, "docs", "alpha.ts"), "export {};\n");
  writeFileSync(join(repo, "src", "foo.ts"), "export {};\n");
  writeFileSync(join(base, "secret.txt"), "root:x:0:0\n");
  writeFileSync(join(base, "shared.ts"), "export {};\n");
  writeFileSync(join(base, "notes", "doc.md"), "# doc\n");
  writeFileSync(join(base, "notes", "a.ts"), "export {};\n");
  symlinkSync(join(base, "secret.txt"), join(repo, "docs", "link.txt"));
});

afterAll(() => {
  process.env.HOME = saved.HOME;
  if (saved.EDITOR === undefined) delete process.env.BLACKBOARD_EDITOR;
  else process.env.BLACKBOARD_EDITOR = saved.EDITOR;
  rmSync(base, { recursive: true, force: true });
});

const roots = (doc: string): DocRoots => {
  const r = docRoots(join(base, doc));
  if (!r) throw new Error("no roots for " + doc);
  return r;
};
const resolve = (token: string, doc = "repo/docs/deep/doc.md") => {
  const ref = parsePathRef(token);
  if (!ref) throw new Error("not a path: " + token);
  return resolveDocPath(ref, roots(doc));
};

describe("parsePathRef", () => {
  test("reads paths with a slash, with optional line and column", () => {
    expect(parsePathRef("lib/markdown.ts")).toEqual({ path: "lib/markdown.ts" });
    expect(parsePathRef("apps/x.ts:42")).toEqual({ path: "apps/x.ts", line: 42 });
    expect(parsePathRef("apps/x.ts:42:7")).toEqual({ path: "apps/x.ts", line: 42, col: 7 });
    expect(parsePathRef("~/code/a.tsx")).toEqual({ path: "~/code/a.tsx" });
  });

  test("a bare file name only means the doc's own folder", () => {
    expect(parsePathRef("package.json")).toEqual({ path: "package.json" });
    // present at the repo root but not next to the doc: no link, rather than a link to a different file
    expect(resolve("package.json", "repo/docs/doc.md")).toBeNull();
  });

  test("rejects prose-like code, URLs, folders and bad positions", () => {
    expect(parsePathRef("npm run build")).toBeNull();
    expect(parsePathRef("readme")).toBeNull();
    expect(parsePathRef("https://example.com/a")).toBeNull();
    expect(parsePathRef("src/")).toBeNull();
    expect(parsePathRef("a.ts:0")).toBeNull();
    expect(parsePathRef("")).toBeNull();
  });
});

describe("resolveDocPath", () => {
  test("a relative path resolves against the doc folder first", () => {
    expect(resolve("local.ts", "repo/docs/doc.md")).toBe(join(base, "repo", "docs", "local.ts"));
  });

  test("then the git repo root", () => {
    expect(resolve("src/foo.ts")).toBe(join(base, "repo", "src", "foo.ts"));
  });

  test("a bare name stays in the doc folder; its parent is not a candidate", () => {
    // alpha.ts sits in repo/docs: a doc in repo/docs finds it, a doc in repo/docs/deep does not
    expect(resolve("alpha.ts", "repo/docs/doc.md")).toBe(join(base, "repo", "docs", "alpha.ts"));
    expect(resolve("alpha.ts")).toBeNull();
  });

  test("an absolute path resolves to itself; a missing one does not", () => {
    expect(resolve(join(base, "repo", "src", "foo.ts"))).toBe(join(base, "repo", "src", "foo.ts"));
    expect(resolve("src/nope.ts")).toBeNull();
  });

  test("~ expands to HOME", () => {
    process.env.HOME = join(base, "repo");
    expect(resolve("~/src/foo.ts")).toBe(join(base, "repo", "src", "foo.ts"));
  });

  test("a path that escapes the doc tree and repo root gets no link", () => {
    expect(resolve("../../secret.txt")).toBeNull();
    expect(resolve("../../../../../../etc/passwd")).toBeNull();
    expect(resolve(join(base, "secret.txt"))).toBeNull();
  });

  test("a symlink that realpaths outside the sandbox gets no link", () => {
    expect(resolve("docs/link.txt")).toBeNull();
  });

  test("outside git, the parent candidate cannot reach past the doc folder", () => {
    expect(resolve("a.ts", "notes/doc.md")).toBe(join(base, "notes", "a.ts"));
    expect(resolve("shared.ts", "notes/doc.md")).toBeNull();
  });

  test("a folder or a missing file is not a link", () => {
    expect(resolve("src/nope.ts")).toBeNull();
    expect(resolve("docs/deep")).toBeNull();
  });
});

describe("sandbox helpers", () => {
  test("realFile accepts regular files only", () => {
    expect(realFile(join(base, "repo", "src", "foo.ts"))).toBe(join(base, "repo", "src", "foo.ts"));
    expect(realFile(join(base, "repo", "src"))).toBeNull();
    expect(realFile(join(base, "repo", "src", "missing.ts"))).toBeNull();
  });

  test("registeredRoots gives each doc's folder and repo root; containedIn checks them", () => {
    const rs = registeredRoots([join(base, "repo", "docs", "deep", "doc.md"), join(base, "notes", "doc.md")]);
    expect(rs.sort()).toEqual([join(base, "repo"), join(base, "repo", "docs", "deep"), join(base, "notes")].sort());
    expect(containedIn(join(base, "repo", "src", "foo.ts"), rs)).toBe(true);
    expect(containedIn(join(base, "secret.txt"), rs)).toBe(false);
    expect(containedIn(join(base, "repo-evil", "x.ts"), rs)).toBe(false);
  });
});

describe("openPath", () => {
  test("BLACKBOARD_EDITOR without placeholders gets the path (with line) appended, no shell", async () => {
    const script = join(base, "fake-editor.sh");
    const out = join(base, "argv.txt");
    writeFileSync(script, `#!/bin/sh\nprintf "%s\\n" "$@" > "${out}"\n`);
    chmodSync(script, 0o755);
    process.env.BLACKBOARD_EDITOR = script + " --reuse";
    const opener = await openPath("/a b/c.ts", 42, 7);
    expect(opener.label).toBe(`${script} --reuse`);
    expect(execFileSync("cat", [out]).toString()).toBe("--reuse\n/a b/c.ts:42:7\n");
  });

  test("BLACKBOARD_EDITOR with {path} and {line} substitutes them", async () => {
    const script = join(base, "fake-editor2.sh");
    const out = join(base, "argv2.txt");
    writeFileSync(script, `#!/bin/sh\nprintf "%s\\n" "$@" > "${out}"\n`);
    chmodSync(script, 0o755);
    process.env.BLACKBOARD_EDITOR = `${script} open {path} --line {line}`;
    await openPath("/x/y.ts", 9);
    expect(execFileSync("cat", [out]).toString()).toBe("open\n/x/y.ts\n--line\n9\n");
  });

  test("without an override, a line number uses code -g and a plain path uses the default app", () => {
    delete process.env.BLACKBOARD_EDITOR;
    const withLine = chooseOpener("/x/y.ts", 12, 3);
    const plain = chooseOpener("/x/y.ts");
    expect(plain.bin).toBe(process.platform === "darwin" ? "open" : "xdg-open");
    expect(plain.args).toEqual(["/x/y.ts"]);
    expect(plain.label).toBe("system default app");
    // code -g is chosen only when the code CLI is present on this machine
    if (withLine.bin === "code") expect(withLine.args).toEqual(["-g", "/x/y.ts:12:3"]);
    else expect(withLine.bin).toBe(plain.bin);
  });

  test("rejects when the editor binary is missing", async () => {
    process.env.BLACKBOARD_EDITOR = join(base, "no-such-editor");
    await expect(openPath(join(base, "repo", "src", "foo.ts"))).rejects.toBeDefined();
  });
});

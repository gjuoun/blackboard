import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "../app/api/open/route";
import { openSession } from "./sessions";

/** Real calls into the route, a temp Blackboard home, and a fake editor that records its argv. */
let base = "";
let home = "";
let argvFile = "";
let doc = "";
let src = "";
const saved = { home: process.env.BLACKBOARD_HOME, editor: process.env.BLACKBOARD_EDITOR };

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "bb-open-route-")));
  home = join(base, "home");
  mkdirSync(home);
  const repo = join(base, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  Bun.spawnSync(["git", "init", "-q", repo]);
  doc = join(repo, "docs", "doc.md");
  src = join(repo, "src", "foo.ts");
  writeFileSync(doc, "# doc\n");
  writeFileSync(src, "export {};\n");
  writeFileSync(join(base, "secret.txt"), "root:x:0:0\n");
  argvFile = join(base, "argv.txt");
  const script = join(base, "fake-editor.sh");
  writeFileSync(script, `#!/bin/sh\nprintf "%s\\n" "$@" > "${argvFile}"\n`);
  chmodSync(script, 0o755);
  process.env.BLACKBOARD_HOME = home;
  openSession(home, doc);
});

beforeEach(() => {
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_EDITOR = join(base, "fake-editor.sh");
});

afterAll(() => {
  process.env.BLACKBOARD_HOME = saved.home;
  if (saved.editor === undefined) delete process.env.BLACKBOARD_EDITOR;
  else process.env.BLACKBOARD_EDITOR = saved.editor;
  rmSync(base, { recursive: true, force: true });
});

/** The route called with a raw query string, as the browser sends it from a path link. */
const call = (query: string, headers: Record<string, string> = {}) => GET(new Request("http://127.0.0.1:38770/api/open" + query, { headers }));
const q = (p: string, extra = "") => `?p=${encodeURIComponent(p)}${extra}`;

describe("GET /api/open", () => {
  test("opens the file at its line and answers with a page naming the opener", async () => {
    const res = await call(q(src, "&l=42"), { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("已打开");
    expect(body).toContain("window.close()");
    // the override ran, and the position reached it
    expect(body).toContain(join(base, "fake-editor.sh"));
    expect(readFileSync(argvFile, "utf8")).toContain(`${src}:42`);
  });

  test("a positionless path reaches the opener without a position", async () => {
    const res = await call(q(src), { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    const argv = readFileSync(argvFile, "utf8");
    expect(argv.trim()).toBe(src);
  });

  test("a request with no Sec-Fetch-Site (a plain client) is served; a cross-site one is refused", async () => {
    expect((await call(q(src))).status).toBe(200);
    expect((await call(q(src), { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  test("400 for a missing, relative, traversing or malformed request", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call(q("src/foo.ts"))).status).toBe(400);
    expect((await call(q(base + "/repo/src/../../secret.txt"))).status).toBe(400);
    expect((await call(q(src, "&l=abc"))).status).toBe(400);
    expect((await call(q(src, "&l=0"))).status).toBe(400);
    expect((await call(q(src, "&c=3"))).status).toBe(400);
  });

  test("404 for a file outside every registered doc folder, a missing file, or a folder", async () => {
    expect((await call(q("/etc/passwd"))).status).toBe(404);
    expect((await call(q(join(base, "secret.txt")))).status).toBe(404);
    expect((await call(q(join(base, "repo", "src", "nope.ts")))).status).toBe(404);
    expect((await call(q(join(base, "repo", "src")))).status).toBe(404);
  });

  test("409 when the editor cannot be run", async () => {
    process.env.BLACKBOARD_EDITOR = join(base, "no-such-editor");
    expect((await call(q(src, "&l=1"))).status).toBe(409);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchor } from "./anchor";
import { close, comment, comments, open, reply, sessions, status } from "./cli";
import { addComment, addReply, mutate, readComments } from "./comments-store";
import { renderPlainText } from "./markdown";
import { sessionCommentsPath } from "./sessions";

const DESIGN = "# Design\n\nThe cache is warm. Later text. The cache is warm. End.\n";
const BIN = new URL("../bin/blackboard.ts", import.meta.url).pathname;

/** A temp home and a docs folder outside any git repo. */
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-cli-")));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(docs, { recursive: true });
  const design = join(docs, "design.md");
  writeFileSync(design, DESIGN);
  writeFileSync(join(docs, "other.md"), "# Other\n");
  return { base, home, docs, design };
}

const run = (home: string, args: string[], cwd?: string) => {
  const p = Bun.spawnSync(["bun", BIN, "--home", home, ...args], { cwd, env: { ...process.env, BLACKBOARD_NO_BROWSER: "1" } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

describe("cli commands", () => {
  test("open is idempotent", () => {
    const { home, design } = setup();
    const a = open(home, design);
    const b = open(home, design);
    expect(b.session.id).toBe(a.session.id);
    expect(a.url).toBe(`http://127.0.0.1:38770/s/${a.session.id}`);
    expect(sessions(home).map((s) => s.title)).toEqual(["Design"]);
  });

  test("open refuses what is not a markdown file", () => {
    const { home, docs } = setup();
    expect(() => open(home, docs)).toThrow(/not a markdown file/);
  });

  test("comment by file path anchors on the chosen repeat, as the agent", async () => {
    const { home, design } = setup();
    const { session } = open(home, design);
    const c = await comment(home, design, "The cache is warm.", "why warm?", "agent", 2);
    const text = await renderPlainText(DESIGN);
    expect(anchor(text, c.quote)?.start).toBe(text.lastIndexOf("The cache is warm."));
    expect(readComments(sessionCommentsPath(home, session.id)).docs["design.md"][0]).toMatchObject({ author: "agent", body: "why warm?" });
  });

  test("reply and resolve find the comment by id; sessions counts open comments", async () => {
    const { home, design } = setup();
    const { session } = open(home, design);
    const c = await comment(home, session.id, "Later text.", "q", "jun");
    expect(sessions(home)[0]).toMatchObject({ id: session.id, open: 1, branch: null, location: design });
    await reply(home, session.id, c.id, "a", "agent");
    await status(home, session.id, c.id, "resolved", "agent");
    expect(comments(home, session.id)).toEqual([]);
    const [all] = comments(home, session.id, { all: true });
    expect(all).toMatchObject({ doc: "design.md", status: "resolved", resolvedBy: "agent" });
    expect(all.replies.map((r) => `${r.author}:${r.body}`)).toEqual(["agent:a"]);
    expect(sessions(home)[0].open).toBe(0);
  });

  test("unknown session, id and quote fail with a clear message", async () => {
    const { home, design, docs } = setup();
    open(home, design);
    await expect(comment(home, "nope", "x", "n", "a")).rejects.toThrow('no session "nope"');
    await expect(comment(home, join(docs, "other.md"), "x", "n", "a")).rejects.toThrow("no session");
    await expect(comment(home, design, "absent", "n", "a")).rejects.toThrow("quote not found");
    await expect(reply(home, design, "c_nope", "t", "a")).rejects.toThrow("no comment c_nope");
  });

  test("close forgets the session but keeps its comments for a later open", async () => {
    const { home, design } = setup();
    const { session } = open(home, design);
    await comment(home, design, "Later text.", "keep me", "jun");
    close(home, design);
    expect(sessions(home)).toEqual([]);
    open(home, design);
    expect(comments(home, design).map((c) => c.body)).toEqual(["keep me"]);
    expect(session.id).toBe(open(home, design).session.id);
  });
});

describe("blackboard wait", () => {
  test("wait returns when jun comments", async () => {
    const { home, design } = setup();
    const { session } = open(home, design);
    const t0 = Date.now();
    const p = Bun.spawn(["bun", BIN, "--home", home, "wait", design, "--json", "--timeout", "10s"], { stdout: "pipe" });
    await Bun.sleep(400);
    await mutate(sessionCommentsPath(home, session.id), (f) =>
      addComment(f, "design.md", { quote: { exact: "Later text.", prefix: "", suffix: "" }, body: "look here", author: "jun" }),
    );
    expect(await p.exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3000);
    const out = JSON.parse(await new Response(p.stdout).text());
    expect(out.events.map((e: { kind: string; author: string; body: string }) => `${e.kind}:${e.author}:${e.body}`)).toEqual(["comment:jun:look here"]);
    expect(out.next).toBe(out.events[0].at);
  });

  test("wait ignores my own reply and times out (exit 3)", async () => {
    const { home, design } = setup();
    const { session } = open(home, design);
    const file = sessionCommentsPath(home, session.id);
    const c = await mutate(file, (f) => addComment(f, "design.md", { quote: { exact: "x", prefix: "", suffix: "" }, body: "old", author: "jun" }));
    const since = new Date().toISOString();
    const p = Bun.spawn(["bun", BIN, "--home", home, "wait", session.id, "--since", since, "--timeout", "1500ms", "--author", "agent"], { stdout: "pipe" });
    await Bun.sleep(300);
    await mutate(file, (f) => addReply(f, "design.md", c.id, { body: "mine", author: "agent" }));
    expect(await p.exited).toBe(3);
    expect(await new Response(p.stdout).text()).toContain(`next: ${since}`);
  });
});

describe("blackboard binary", () => {
  test("open prints id and url; comment by a relative path from the doc's folder; exit codes follow the contract", () => {
    const { home, docs } = setup();
    const opened = run(home, ["open", "--no-browser", "design.md"], docs);
    expect(opened.code).toBe(0);
    const [id, url] = opened.out.trim().split(/\s+/);
    expect(url).toBe(`http://127.0.0.1:38770/s/${id}`);

    const made = run(home, ["comment", "design.md", "--quote", "Later text.", "--author", "agent", "please", "explain"], docs);
    expect(made.code).toBe(0);
    const listed = run(home, ["comments", id, "--json"]);
    expect(JSON.parse(listed.out).map((c: { body: string; author: string }) => `${c.author}:${c.body}`)).toEqual(["agent:please explain"]);
    const rows = JSON.parse(run(home, ["sessions", "--json"]).out);
    expect(rows.map((r: { title: string; open: number }) => `${r.title}:${r.open}`)).toEqual(["Design:1"]);

    expect(run(home, ["comments", "nope"]).code).toBe(1);
    expect(run(home, ["open", "--no-browser", docs]).code).toBe(1);
    expect(run(home, ["reply", id]).code).toBe(2);
    expect(run(home, ["frobnicate"]).code).toBe(2);
    expect(run(home, ["import", join(docs, "no-such-root")]).code).toBe(1);
    expect(run(home, ["import"]).code).toBe(2);
  });
});

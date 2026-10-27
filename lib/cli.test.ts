import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchor } from "./anchor";
import { close, comment, comments, formatComments, open, reply, sessions, status } from "./cli";
import { readComments } from "./comments-store";
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
    const [all] = comments(home, session.id);
    expect(all).toMatchObject({ doc: "design.md", status: "resolved", resolvedBy: "agent" });
    expect(all.replies.map((r) => `${r.author}:${r.body}`)).toEqual(["agent:a"]);
    expect(sessions(home)[0].open).toBe(0);
  });

  test("comments lists resolved comments with their replies and reply ids", async () => {
    const { home, design } = setup();
    open(home, design);
    const c = await comment(home, design, "Later text.", "q", "jun");
    await reply(home, design, c.id, "done", "agent");
    await status(home, design, c.id, "resolved", "agent");
    const text = formatComments(comments(home, design));
    expect(text).toContain(`${c.id}  design.md  resolved  jun`);
    expect(text).toMatch(/↳ r_\w+  agent: done/);
  });

  test("reply accepts a reply id and joins that comment's thread", async () => {
    const { home, design } = setup();
    open(home, design);
    const c = await comment(home, design, "Later text.", "q", "jun");
    await reply(home, design, c.id, "first", "agent");
    const [{ replies: [first] }] = comments(home, design);
    const parent = await reply(home, design, first.id, "reply to the reply", "jun");
    expect(parent.id).toBe(c.id);
    expect(comments(home, design)[0].replies.map((r) => `${r.author}:${r.body}`)).toEqual(["agent:first", "jun:reply to the reply"]);
  });

  test("the CLI says when a reply id joined a comment's thread", async () => {
    const { home, design } = setup();
    const { session } = open(home, design);
    const c = await comment(home, session.id, "The cache is warm.", "q", "jun");
    await reply(home, session.id, c.id, "first", "agent");
    const replyId = comments(home, session.id)[0].replies[0].id;
    const joined = run(home, ["reply", session.id, replyId, "second"]);
    expect(joined.code).toBe(0);
    expect(joined.out).toContain(`joined thread of ${c.id}`);
    const direct = run(home, ["reply", session.id, c.id, "third"]);
    expect(direct.out).not.toContain("joined thread");
    expect(comments(home, session.id)[0].replies.map((x) => x.body)).toEqual(["first", "second", "third"]);
  });

  test("unknown session, id and quote fail with a clear message", async () => {
    const { home, design, docs } = setup();
    open(home, design);
    await expect(comment(home, "nope", "x", "n", "a")).rejects.toThrow('no session "nope"');
    await expect(comment(home, join(docs, "other.md"), "x", "n", "a")).rejects.toThrow("no session");
    await expect(comment(home, design, "absent", "n", "a")).rejects.toThrow("quote not found");
    await expect(reply(home, design, "c_nope", "t", "a")).rejects.toThrow("no comment c_nope");
    await expect(reply(home, design, "r_nope", "t", "a")).rejects.toThrow("no comment r_nope");
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
  });
});

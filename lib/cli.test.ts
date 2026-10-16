import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchor } from "./anchor";
import { comment, comments, reply, status } from "./cli";
import { readComments } from "./comments-store";
import { renderPlainText } from "./markdown";
import { makeFixtureRoot } from "./test-fixture";

const DESIGN = "# Design\n\nThe cache is warm. Later text. The cache is warm. End.\n";
const BIN = new URL("../bin/blackboard.ts", import.meta.url).pathname;

function setup() {
  const fx = makeFixtureRoot();
  writeFileSync(join(fx.demo, "design.md"), DESIGN);
  return fx;
}

const run = (root: string, ...args: string[]) => {
  const p = Bun.spawnSync(["bun", BIN, "--root", root, ...args]);
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

describe("cli commands", () => {
  test("comment anchors on the chosen repeat, as the agent", async () => {
    const { root, demo } = setup();
    const c = await comment(root, "demo", "design.md", "The cache is warm.", "why warm?", "agent", 2);
    const text = await renderPlainText(DESIGN);
    expect(anchor(text, c.quote)?.start).toBe(text.lastIndexOf("The cache is warm."));
    expect(readComments(demo).docs["design.md"][0]).toMatchObject({ author: "agent", body: "why warm?" });
  });

  test("reply and resolve find the comment's doc by id", async () => {
    const { root } = setup();
    const c = await comment(root, "demo", "design.md", "Later text.", "q", "jun");
    await reply(root, "demo", c.id, "a", "agent");
    await status(root, "demo", c.id, "resolved", "agent");
    expect(comments(root, "demo")).toEqual([]);
    const [all] = comments(root, "demo", { all: true });
    expect(all).toMatchObject({ doc: "design.md", status: "resolved", resolvedBy: "agent" });
    expect(all.replies.map((r) => `${r.author}:${r.body}`)).toEqual(["agent:a"]);
  });

  test("unknown board, doc, id and quote fail with a clear message", async () => {
    const { root } = setup();
    await expect(comment(root, "nope", "design.md", "x", "n", "a")).rejects.toThrow('no board "nope"');
    await expect(comment(root, "demo", "missing.md", "x", "n", "a")).rejects.toThrow('no doc "missing.md"');
    await expect(comment(root, "demo", "design.md", "absent", "n", "a")).rejects.toThrow("quote not found");
    await expect(reply(root, "demo", "c_nope", "t", "a")).rejects.toThrow("no comment c_nope");
  });
});

describe("blackboard binary", () => {
  test("comments --json lists what comment wrote; exit codes follow the contract", () => {
    const { root } = setup();
    const made = run(root, "comment", "demo", "design.md", "--quote", "Later text.", "--author", "agent", "please", "explain");
    expect(made.code).toBe(0);
    const listed = run(root, "comments", "demo", "--json");
    expect(JSON.parse(listed.out).map((c: { body: string; author: string }) => `${c.author}:${c.body}`)).toEqual(["agent:please explain"]);
    expect(run(root, "comments", "nope").code).toBe(1);
    expect(run(root, "reply", "demo").code).toBe(2);
    expect(run(root, "frobnicate").code).toBe(2);
  });
});

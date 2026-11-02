import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../test/app";
import { DESIGN, repoSetup, runCli, setup } from "../../test/fixtures/cli";
import { anchor } from "../anchor";
import { readComments } from "../comments-store";
import { renderPlainText } from "../markdown";
import { sessionCommentsPath } from "../sessions";
import { formatComments } from "../cli";
import { comment, commentOnCode, comments, reply, status } from "./comments";
import { open, sessions } from "./sessions";

describe("comments", () => {
  test("comment by file path anchors on the chosen repeat, as the agent", async () => {
    const { home, design } = setup();
    const { session } = await run(open(home, design));
    const c = await run(comment(home, design, "The cache is warm.", "why warm?", "agent", 2));
    const text = await renderPlainText(DESIGN);
    expect(anchor(text, c.quote!)?.start).toBe(text.lastIndexOf("The cache is warm."));
    expect(readComments(sessionCommentsPath(home, session.id)).docs["design.md"][0]).toMatchObject({ author: "agent", body: "why warm?" });
  });

  test("reply and resolve find the comment by id; sessions counts open comments", async () => {
    const { home, design } = setup();
    const { session } = await run(open(home, design));
    const c = await run(comment(home, session.id, "Later text.", "q", "jun"));
    expect((await run(sessions(home)))[0]).toMatchObject({ id: session.id, open: 1, branch: null, location: design });
    await run(reply(home, session.id, c.id, "a", "agent"));
    await run(status(home, session.id, c.id, "resolved", "agent"));
    const [all] = await run(comments(home, session.id));
    expect(all).toMatchObject({ doc: "design.md", status: "resolved", resolvedBy: "agent" });
    expect(all.replies.map((r) => `${r.author}:${r.body}`)).toEqual(["agent:a"]);
    expect((await run(sessions(home)))[0].open).toBe(0);
  });

  test("comments lists resolved comments with their replies and reply ids", async () => {
    const { home, design } = setup();
    await run(open(home, design));
    const c = await run(comment(home, design, "Later text.", "q", "jun"));
    await run(reply(home, design, c.id, "done", "agent"));
    await run(status(home, design, c.id, "resolved", "agent"));
    const text = formatComments(await run(comments(home, design)));
    expect(text).toContain(`${c.id}  design.md  resolved  jun`);
    expect(text).toMatch(/\u21b3 r_\w+  agent: done/);
  });

  test("reply accepts a reply id and joins that comment thread", async () => {
    const { home, design } = setup();
    await run(open(home, design));
    const c = await run(comment(home, design, "Later text.", "q", "jun"));
    await run(reply(home, design, c.id, "first", "agent"));
    const [{ replies: [first] }] = await run(comments(home, design));
    const parent = await run(reply(home, design, first.id, "reply to the reply", "jun"));
    expect(parent.id).toBe(c.id);
    expect((await run(comments(home, design)))[0].replies.map((r) => `${r.author}:${r.body}`)).toEqual(["agent:first", "jun:reply to the reply"]);
  });

  test("the CLI says when a reply id joined a comment thread", async () => {
    const { home, design } = setup();
    const { session } = await run(open(home, design));
    const c = await run(comment(home, session.id, "The cache is warm.", "q", "jun"));
    await run(reply(home, session.id, c.id, "first", "agent"));
    const replyId = (await run(comments(home, session.id)))[0].replies[0].id;
    const joined = runCli(home, ["reply", session.id, replyId, "second"]);
    expect(joined.code).toBe(0);
    expect(joined.out).toContain(`joined thread of ${c.id}`);
    const direct = runCli(home, ["reply", session.id, c.id, "third"]);
    expect(direct.out).not.toContain("joined thread");
    expect((await run(comments(home, session.id)))[0].replies.map((x) => x.body)).toEqual(["first", "second", "third"]);
  });

  test("unknown session, id and quote fail with a clear message", async () => {
    const { home, design, docs } = setup();
    await run(open(home, design));
    await expect(run(comment(home, "nope", "x", "n", "a"))).rejects.toThrow('no session "nope"');
    await expect(run(comment(home, join(docs, "other.md"), "x", "n", "a"))).rejects.toThrow("no session");
    await expect(run(comment(home, design, "absent", "n", "a"))).rejects.toThrow("quote not found");
    await expect(run(reply(home, design, "c_nope", "t", "a"))).rejects.toThrow("no comment c_nope");
    await expect(run(reply(home, design, "r_nope", "t", "a"))).rejects.toThrow("no comment r_nope");
  });
});

describe("code-anchored comments", () => {
  test("comment by path:line stores the anchor and its line text", async () => {
    const { home, design, source } = repoSetup();
    await run(open(home, design));
    const c = await run(commentOnCode(home, design, "lib/residency.ts:L3", "why the gate?", "agent"));
    expect(c.code).toEqual({ path: "lib/residency.ts", startLine: 3, endLine: 3, side: "new", lineText: "  return gate;" });
    expect(c.quote).toBeUndefined();
    const listed = await run(comments(home, design));
    expect(listed[0].codeState).toEqual({ orphaned: false, movedTo: null });
    const text = formatComments(listed);
    expect(text).toContain("lib/residency.ts:L3");
    expect(text).toContain("why the gate?");
    // The doc own file is untouched: the anchor is metadata, not a rewrite of the source.
    expect(readFileSync(source, "utf8")).toContain("return gate;");
  });

  test("a drifted line reads as L3 -> L4 and the stored anchor is not rewritten", async () => {
    const { home, design, source } = repoSetup();
    await run(open(home, design));
    const c = await run(commentOnCode(home, design, "lib/residency.ts:L3", "still here?", "jun"));
    writeFileSync(source, "export function residency() {\n  // drifted\n  const gate = 1;\n  return gate;\n}\n");
    const text = formatComments(await run(comments(home, design)));
    expect(text).toContain("L3 \u21a6 \u73b0 L4");
    expect(c.code?.startLine).toBe(3);
    const stored = (await run(comments(home, design)))[0];
    expect(stored.code?.startLine).toBe(3);
    expect(stored.codeState).toEqual({ orphaned: true, movedTo: 4 });
  });

  test("a bad reference, a missing line and an escaping path are all refused", async () => {
    const { home, design } = repoSetup();
    await run(open(home, design));
    await expect(run(commentOnCode(home, design, "lib/residency.ts", "x", "jun"))).rejects.toThrow(/--code takes/);
    await expect(run(commentOnCode(home, design, "lib/residency.ts:L99", "x", "jun"))).rejects.toThrow(/no line 99/);
    await expect(run(commentOnCode(home, design, "../outside.ts:L1", "x", "jun"))).rejects.toThrow(/--code takes/);
    await expect(run(commentOnCode(home, design, "lib/missing.ts:L1", "x", "jun"))).rejects.toThrow(/no such file/);
  });
});
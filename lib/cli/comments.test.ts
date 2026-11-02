import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { run } from "../../test/app";
import { DESIGN, runCli, setup } from "../../test/fixtures/cli";
import { anchor } from "../anchor";
import { readComments } from "../comments-store";
import { renderPlainText } from "../markdown";
import { sessionCommentsPath } from "../sessions";
import { formatComments } from "../cli";
import { comment, comments, reply, status } from "./comments";
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
  }, 30_000);

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

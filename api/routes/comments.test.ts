import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LOCAL, fixture, register } from "../../test/api-fixture";
import { comment, comments, reply } from "../../lib/cli/comments";
import { run } from "../../test/app";
import { app } from "../app";

/**
 * The comments route, driven through the API app. Same cases as the Next route test it replaces:
 * bodies rendered to HTML with the raw text kept, a POST that returns the rendered comment, and the
 * reply-join rules: a reply id names a reply on the same comment, a reply id in the comment slot is
 * refused. Comments are written through the store helpers the CLI uses, so each case starts from
 * the same state a real session has.
 */

const json = (payload: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { ...LOCAL, "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const get = (session: string) => app.request(`http://127.0.0.1/api/comments?session=${session}`, { headers: LOCAL });
const post = (payload: unknown) => app.request("http://127.0.0.1/api/comments", json(payload));
const patch = (payload: unknown) => app.request("http://127.0.0.1/api/comments", json(payload, "PATCH"));

async function setup() {
  const { home, docs } = await fixture("bb-route-", { "design.md": "# Design\n\nLater text. More text.\n" });
  const design = join(docs, "design.md");
  const session = await register(home, design);
  return { home, design, session: session.id };
}

describe("comments API renders bodies", () => {
  test("GET returns each comment and reply with its body rendered to HTML and the raw text kept", async () => {
    const { home, design, session } = await setup();
    const c = await run(comment(home, design, "Later text.", "**first** note", "jun"));
    await run(reply(home, design, c.id, "answer with `x`", "agent"));
    const { comments: list } = await (await get(session)).json();
    expect(list[0].body).toBe("**first** note");
    expect(list[0].html).toContain("<strong>first</strong>");
    expect(list[0].replies[0].html).toContain("<code>x</code>");
    expect(list[0].replies[0].body).toBe("answer with `x`");
  });

  test("POST returns the new comment with its body rendered, and drops a script link", async () => {
    const { session } = await setup();
    const res = await post({ session, quote: { exact: "More text.", prefix: "Later text. ", suffix: "" }, body: "see [x](javascript:alert(1))" });
    expect(res.status).toBe(201);
    const { comment: made } = await res.json();
    expect(made.html).toBe("<p>see x</p>");
  });
});

describe("reply joins the comment thread", () => {
  test("a reply with a reply id joins that comment: one flat list, one more entry, no nesting", async () => {
    const { home, design, session } = await setup();
    const c = await run(comment(home, design, "Later text.", "q", "jun"));
    await run(reply(home, design, c.id, "first", "agent"));
    await run(reply(home, design, c.id, "second", "agent"));
    const [first, second] = (await run(comments(home, design)))[0].replies;
    const res = await patch({ session, id: c.id, action: "reply", body: "third, joined from a reply", author: "jun", replyId: second.id });
    expect(res.status).toBe(200);
    const { comment: updated } = await res.json();
    expect(updated.id).toBe(c.id);
    expect(updated.replies.map((r: { body: string }) => r.body)).toEqual(["first", "second", "third, joined from a reply"]);
    expect(updated.replies.every((r: Record<string, unknown>) => !("replies" in r))).toBe(true);
    expect(first.id).not.toBe(second.id);
  });

  test("a reply id that is not on this comment is refused", async () => {
    const { home, design, session } = await setup();
    const c = await run(comment(home, design, "Later text.", "q", "jun"));
    const other = await run(comment(home, design, "More text.", "p", "jun"));
    await run(reply(home, design, other.id, "elsewhere", "agent"));
    const otherReply = (await run(comments(home, design))).find((x) => x.id === other.id)!.replies[0];
    const res = await patch({ session, id: c.id, action: "reply", body: "x", replyId: otherReply.id });
    expect(res.status).toBe(404);
  });

  test("the id must be a comment id: a reply id in its place is refused", async () => {
    const { home, design, session } = await setup();
    const c = await run(comment(home, design, "Later text.", "q", "jun"));
    await run(reply(home, design, c.id, "first", "agent"));
    const replyId = (await run(comments(home, design)))[0].replies[0].id;
    const res = await patch({ session, id: replyId, action: "reply", body: "x" });
    expect(res.status).toBe(404);
  });
});

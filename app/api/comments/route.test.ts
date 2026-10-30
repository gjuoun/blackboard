import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { comment, comments, open, reply } from "@/lib/cli";
import { GET, PATCH, POST } from "./route";

/** A temp Blackboard home and one doc. The route reads the home from BLACKBOARD_HOME on each call. */
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-route-")));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(docs, { recursive: true });
  const design = join(docs, "design.md");
  writeFileSync(design, "# Design\n\nLater text. More text.\n");
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  const { session } = open(home, design);
  return { home, design, session: session.id };
}

const get = (session: string) => GET(new NextRequest("http://127.0.0.1/api/comments?session=" + session));
const patch = (payload: Record<string, unknown>) =>
  PATCH(new NextRequest("http://127.0.0.1/api/comments", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

describe("comments API renders bodies", () => {
  test("GET returns each comment and reply with its body rendered to HTML and the raw text kept", async () => {
    const { home, design, session } = setup();
    const c = await comment(home, design, "Later text.", "**first** note", "jun");
    await reply(home, design, c.id, "answer with `x`", "agent");
    const res = await get(session);
    const { comments: list } = await res.json();
    expect(list[0].body).toBe("**first** note");
    expect(list[0].html).toContain("<strong>first</strong>");
    expect(list[0].replies[0].html).toContain("<code>x</code>");
    expect(list[0].replies[0].body).toBe("answer with `x`");
  });

  test("POST returns the new comment with its body rendered", async () => {
    const { session } = setup();
    const res = await POST(new NextRequest("http://127.0.0.1/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session, quote: { exact: "More text.", prefix: "Later text. ", suffix: "" }, body: "see [x](javascript:alert(1))" }) }));
    const { comment: made } = await res.json();
    expect(made.html).toBe("<p>see x</p>");
  });
});

describe("POST accepts a code anchor", () => {
  const code = { path: "lib/residency.ts", startLine: 3, endLine: 3, side: "new" as const, lineText: "  return gate;" };
  const post = (payload: Record<string, unknown>) =>
    POST(new NextRequest("http://127.0.0.1/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));

  test("a code-anchored comment is stored and answered with its anchor", async () => {
    const { home, design, session } = setup();
    const res = await post({ session, code, body: "why the gate?", author: "jun" });
    expect(res.status).toBe(201);
    const { comment: made } = await res.json();
    expect(made.code).toEqual(code);
    expect(made.html).toBe("<p>why the gate?</p>");
    expect(comments(home, design)[0].code).toEqual(code);
  });

  test("both anchors, neither anchor, and a malformed anchor are all refused", async () => {
    const { session } = setup();
    const both = await post({ session, quote: { exact: "More text.", prefix: "Later text. ", suffix: "" }, code, body: "x" });
    expect(both.status).toBe(400);
    expect((await post({ session, body: "x" })).status).toBe(400);
    expect((await post({ session, code: { ...code, path: "../outside.ts" }, body: "x" })).status).toBe(400);
    expect((await post({ session, code: { ...code, startLine: 0 }, body: "x" })).status).toBe(400);
    expect((await post({ session, code, body: "" })).status).toBe(400);
  });
});

describe("reply joins the comment thread", () => {
  test("a reply with a reply id joins that comment: one flat list, one more entry, no nesting", async () => {
    const { home, design, session } = setup();
    const c = await comment(home, design, "Later text.", "q", "jun");
    await reply(home, design, c.id, "first", "agent");
    await reply(home, design, c.id, "second", "agent");
    const [first, second] = comments(home, design)[0].replies;
    const res = await patch({ session, id: c.id, action: "reply", body: "third, joined from a reply", author: "jun", replyId: second.id });
    expect(res.status).toBe(200);
    const { comment: updated } = await res.json();
    expect(updated.id).toBe(c.id);
    expect(updated.replies.map((r: { body: string }) => r.body)).toEqual(["first", "second", "third, joined from a reply"]);
    expect(updated.replies.every((r: Record<string, unknown>) => !("replies" in r))).toBe(true);
    expect(first.id).not.toBe(second.id);
  });

  test("a reply id that is not on this comment is refused", async () => {
    const { home, design, session } = setup();
    const c = await comment(home, design, "Later text.", "q", "jun");
    const other = await comment(home, design, "More text.", "p", "jun");
    await reply(home, design, other.id, "elsewhere", "agent");
    const otherReply = comments(home, design).find((x) => x.id === other.id)!.replies[0];
    const res = await patch({ session, id: c.id, action: "reply", body: "x", replyId: otherReply.id });
    expect(res.status).toBe(404);
  });

  test("the id must be a comment id: a reply id in its place is refused", async () => {
    const { home, design, session } = setup();
    const c = await comment(home, design, "Later text.", "q", "jun");
    await reply(home, design, c.id, "first", "agent");
    const replyId = comments(home, design)[0].replies[0].id;
    const res = await patch({ session, id: replyId, action: "reply", body: "x" });
    expect(res.status).toBe(404);
  });
});

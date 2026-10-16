import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { addComment, addReply, commentsPath, deleteComment, deleteReply, editComment, editReply, mutate, readComments, setStatus } from "./comments-store";
import { makeFixtureRoot } from "./test-fixture";

const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
const fresh = () => makeFixtureRoot().demo;

describe("comment file", () => {
  test("reads as empty when the board has no comments yet", () => {
    const demo = fresh();
    expect(readComments(commentsPath(demo))).toEqual({ version: 1, docs: {} });
    expect(existsSync(join(demo, ".blackboard"))).toBe(false);
  });

  test("round-trips a comment, a reply and a resolve through the file on disk", async () => {
    const demo = fresh();
    const c = await mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "Why warm?", author: "jun" }));
    await mutate(commentsPath(demo), (f) => addReply(f, "design.md", c.id, { body: "Preloaded at boot.", author: "agent" }));
    await mutate(commentsPath(demo), (f) => setStatus(f, "design.md", c.id, "resolved", "jun"));

    const onDisk = JSON.parse(readFileSync(join(demo, ".blackboard", "comments.json"), "utf8"));
    const stored = onDisk.docs["design.md"][0];
    expect(stored.quote).toEqual(quote);
    expect(stored.body).toBe("Why warm?");
    expect(stored.status).toBe("resolved");
    expect(stored.resolvedBy).toBe("jun");
    expect(stored.replies.map((r: { body: string }) => r.body)).toEqual(["Preloaded at boot."]);

    await mutate(commentsPath(demo), (f) => setStatus(f, "design.md", c.id, "open", "jun"));
    const reopened = readComments(commentsPath(demo)).docs["design.md"][0];
    expect(reopened).toMatchObject({ status: "open", reopenedBy: "jun" });
    expect(reopened.resolvedAt).toBeUndefined();
  });

  test("two concurrent mutations both land", async () => {
    const demo = fresh();
    await Promise.all([
      mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "one", author: "jun" })),
      mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "two", author: "jun" })),
    ]);
    expect(readComments(commentsPath(demo)).docs["design.md"].map((c) => c.body).sort()).toEqual(["one", "two"]);
  });

  test("six processes adding at once all land", async () => {
    const demo = fresh();
    const child = new URL("./test-mutator.ts", import.meta.url).pathname;
    const procs = Array.from({ length: 6 }, (_, p) => Bun.spawn(["bun", child, demo, "15", `p${p}`], { stderr: "pipe" }));
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual([0, 0, 0, 0, 0, 0]);
    expect(readComments(commentsPath(demo)).docs["design.md"].length).toBe(90);
  }, 20_000);

  test("leaves no temp files behind", async () => {
    const demo = fresh();
    await mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }));
    expect(readdirSync(join(demo, ".blackboard"))).toEqual(["comments.json"]);
  });

  test("refuses to overwrite a file it cannot parse", async () => {
    const demo = fresh();
    mkdirSync(join(demo, ".blackboard"));
    writeFileSync(join(demo, ".blackboard", "comments.json"), "{ half written");
    await expect(mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }))).rejects.toThrow();
    expect(readFileSync(join(demo, ".blackboard", "comments.json"), "utf8")).toBe("{ half written");
  });

  test("errors on an unknown comment id instead of creating one", async () => {
    const demo = fresh();
    await expect(mutate(commentsPath(demo), (f) => addReply(f, "design.md", "c_missing", { body: "x", author: "jun" }))).rejects.toThrow(/not found/);
  });

  test("edits a comment and a reply, stamping editedAt", async () => {
    const demo = fresh();
    const c = await mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "typo", author: "jun" }));
    const withReply = await mutate(commentsPath(demo), (f) => addReply(f, "design.md", c.id, { body: "re typo", author: "jun" }));
    await mutate(commentsPath(demo), (f) => editComment(f, "design.md", c.id, "fixed"));
    await mutate(commentsPath(demo), (f) => editReply(f, "design.md", c.id, withReply.replies[0].id, "re fixed"));
    const stored = readComments(commentsPath(demo)).docs["design.md"][0];
    expect(stored.body).toBe("fixed");
    expect(stored.editedAt).toBeString();
    expect(stored.replies[0].body).toBe("re fixed");
    expect(stored.replies[0].editedAt).toBeString();
  });

  test("deletes a reply, then the comment, and drops the empty doc key", async () => {
    const demo = fresh();
    const c = await mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "gone soon", author: "jun" }));
    const keep = await mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "stays", author: "jun" }));
    const r = await mutate(commentsPath(demo), (f) => addReply(f, "design.md", c.id, { body: "r", author: "jun" }));
    await mutate(commentsPath(demo), (f) => deleteReply(f, "design.md", c.id, r.replies[0].id));
    expect(readComments(commentsPath(demo)).docs["design.md"].find((x) => x.id === c.id)?.replies).toEqual([]);
    await mutate(commentsPath(demo), (f) => deleteComment(f, "design.md", c.id));
    expect(readComments(commentsPath(demo)).docs["design.md"].map((x) => x.id)).toEqual([keep.id]);
    await mutate(commentsPath(demo), (f) => deleteComment(f, "design.md", keep.id));
    expect(readComments(commentsPath(demo)).docs).toEqual({});
  });

  test("errors on an unknown reply id", async () => {
    const demo = fresh();
    const c = await mutate(commentsPath(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }));
    await expect(mutate(commentsPath(demo), (f) => editReply(f, "design.md", c.id, "r_missing", "y"))).rejects.toThrow(/not found/);
  });

  test("puts the file under .blackboard in the board", () => {
    const demo = fresh();
    expect(commentsPath(demo)).toBe(join(demo, ".blackboard", "comments.json"));
  });
});

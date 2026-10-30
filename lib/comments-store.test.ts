import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addComment, addReply, deleteComment, deleteReply, editComment, editReply, mutate, readComments, setStatus } from "./comments-store";

const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
/** A temp folder; its comment file is <dir>/.blackboard/comments.json and does not exist yet. */
const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-store-")));
const fileIn = (dir: string) => join(dir, ".blackboard", "comments.json");

describe("comment file", () => {
  test("reads as empty when there are no comments yet", () => {
    const demo = fresh();
    expect(readComments(fileIn(demo))).toEqual({ version: 1, docs: {} });
    expect(existsSync(join(demo, ".blackboard"))).toBe(false);
  });

  test("round-trips a comment, a reply and a resolve through the file on disk", async () => {
    const demo = fresh();
    const c = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "Why warm?", author: "jun" }));
    await mutate(fileIn(demo), (f) => addReply(f, "design.md", c.id, { body: "Preloaded at boot.", author: "agent" }));
    await mutate(fileIn(demo), (f) => setStatus(f, "design.md", c.id, "resolved", "jun"));

    const onDisk = JSON.parse(readFileSync(join(demo, ".blackboard", "comments.json"), "utf8"));
    const stored = onDisk.docs["design.md"][0];
    expect(stored.quote).toEqual(quote);
    expect(stored.body).toBe("Why warm?");
    expect(stored.status).toBe("resolved");
    expect(stored.resolvedBy).toBe("jun");
    expect(stored.replies.map((r: { body: string }) => r.body)).toEqual(["Preloaded at boot."]);

    await mutate(fileIn(demo), (f) => setStatus(f, "design.md", c.id, "open", "jun"));
    const reopened = readComments(fileIn(demo)).docs["design.md"][0];
    expect(reopened).toMatchObject({ status: "open", reopenedBy: "jun" });
    expect(reopened.resolvedAt).toBeUndefined();
  });

  test("two concurrent mutations both land", async () => {
    const demo = fresh();
    await Promise.all([
      mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "one", author: "jun" })),
      mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "two", author: "jun" })),
    ]);
    expect(readComments(fileIn(demo)).docs["design.md"].map((c) => c.body).sort()).toEqual(["one", "two"]);
  });

  test("six processes adding at once all land", async () => {
    const demo = fresh();
    const child = new URL("./test-mutator.ts", import.meta.url).pathname;
    const procs = Array.from({ length: 6 }, (_, p) => Bun.spawn(["bun", child, fileIn(demo), "15", `p${p}`], { stderr: "pipe" }));
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes).toEqual([0, 0, 0, 0, 0, 0]);
    expect(readComments(fileIn(demo)).docs["design.md"].length).toBe(90);
  }, 20_000);

  test("leaves no temp files behind", async () => {
    const demo = fresh();
    await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }));
    expect(readdirSync(join(demo, ".blackboard"))).toEqual(["comments.json"]);
  });

  test("refuses to overwrite a file it cannot parse", async () => {
    const demo = fresh();
    mkdirSync(join(demo, ".blackboard"));
    writeFileSync(join(demo, ".blackboard", "comments.json"), "{ half written");
    await expect(mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }))).rejects.toThrow();
    expect(readFileSync(join(demo, ".blackboard", "comments.json"), "utf8")).toBe("{ half written");
  });

  test("errors on an unknown comment id instead of creating one", async () => {
    const demo = fresh();
    await expect(mutate(fileIn(demo), (f) => addReply(f, "design.md", "c_missing", { body: "x", author: "jun" }))).rejects.toThrow(/not found/);
  });

  test("edits a comment and a reply, stamping editedAt", async () => {
    const demo = fresh();
    const c = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "typo", author: "jun" }));
    const withReply = await mutate(fileIn(demo), (f) => addReply(f, "design.md", c.id, { body: "re typo", author: "jun" }));
    await mutate(fileIn(demo), (f) => editComment(f, "design.md", c.id, "fixed"));
    await mutate(fileIn(demo), (f) => editReply(f, "design.md", c.id, withReply.replies[0].id, "re fixed"));
    const stored = readComments(fileIn(demo)).docs["design.md"][0];
    expect(stored.body).toBe("fixed");
    expect(stored.editedAt).toBeString();
    expect(stored.replies[0].body).toBe("re fixed");
    expect(stored.replies[0].editedAt).toBeString();
  });

  test("deletes a reply, then the comment, and drops the empty doc key", async () => {
    const demo = fresh();
    const c = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "gone soon", author: "jun" }));
    const keep = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "stays", author: "jun" }));
    const r = await mutate(fileIn(demo), (f) => addReply(f, "design.md", c.id, { body: "r", author: "jun" }));
    await mutate(fileIn(demo), (f) => deleteReply(f, "design.md", c.id, r.replies[0].id));
    expect(readComments(fileIn(demo)).docs["design.md"].find((x) => x.id === c.id)?.replies).toEqual([]);
    await mutate(fileIn(demo), (f) => deleteComment(f, "design.md", c.id));
    expect(readComments(fileIn(demo)).docs["design.md"].map((x) => x.id)).toEqual([keep.id]);
    await mutate(fileIn(demo), (f) => deleteComment(f, "design.md", keep.id));
    expect(readComments(fileIn(demo)).docs).toEqual({});
  });

  test("a code anchor round-trips beside the passage anchors, in the same v1 file", async () => {
    const demo = fresh();
    const code = { path: "lib/residency.ts", startLine: 3, endLine: 3, side: "new" as const, lineText: "  return gate;" };
    const byCode = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { code, body: "why here?", author: "agent" }));
    const byQuote = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "and here", author: "jun" }));
    const stored = readComments(fileIn(demo)).docs["design.md"];
    expect(stored.find((c) => c.id === byCode.id)?.code).toEqual(code);
    expect(stored.find((c) => c.id === byCode.id)?.quote).toBeUndefined();
    expect(stored.find((c) => c.id === byQuote.id)?.quote).toEqual(quote);
    expect(stored.find((c) => c.id === byQuote.id)?.code).toBeUndefined();
    expect(JSON.parse(readFileSync(fileIn(demo), "utf8")).version).toBe(1);
  });

  test("a comment without an anchor is refused by the store", async () => {
    const demo = fresh();
    await expect(
      mutate(fileIn(demo), (f) => addComment(f, "design.md", { body: "no anchor", author: "jun" } as Parameters<typeof addComment>[2])),
    ).rejects.toThrow(/quote or a code anchor/);
  });

  test("errors on an unknown reply id", async () => {
    const demo = fresh();
    const c = await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }));
    await expect(mutate(fileIn(demo), (f) => editReply(f, "design.md", c.id, "r_missing", "y"))).rejects.toThrow(/not found/);
  });

  test("creates the comment file's folder on the first write", async () => {
    const demo = fresh();
    await mutate(fileIn(demo), (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }));
    expect(existsSync(fileIn(demo))).toBe(true);
  });
});

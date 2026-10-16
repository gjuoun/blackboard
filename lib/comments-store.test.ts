import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { addComment, addReply, commentsPath, mutate, readComments, setStatus } from "./comments-store";
import { makeFixtureRoot } from "./test-fixture";

const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
const fresh = () => makeFixtureRoot().demo;

describe("comment file", () => {
  test("reads as empty when the board has no comments yet", () => {
    const demo = fresh();
    expect(readComments(demo)).toEqual({ version: 1, docs: {} });
    expect(existsSync(join(demo, ".blackboard"))).toBe(false);
  });

  test("round-trips a comment, a reply and a resolve through the file on disk", async () => {
    const demo = fresh();
    const c = await mutate(demo, (f) => addComment(f, "design.md", { quote, body: "Why warm?", author: "jun" }));
    await mutate(demo, (f) => addReply(f, "design.md", c.id, { body: "Preloaded at boot.", author: "agent" }));
    await mutate(demo, (f) => setStatus(f, "design.md", c.id, "resolved", "jun"));

    const onDisk = JSON.parse(readFileSync(join(demo, ".blackboard", "comments.json"), "utf8"));
    const stored = onDisk.docs["design.md"][0];
    expect(stored.quote).toEqual(quote);
    expect(stored.body).toBe("Why warm?");
    expect(stored.status).toBe("resolved");
    expect(stored.resolvedBy).toBe("jun");
    expect(stored.replies.map((r: { body: string }) => r.body)).toEqual(["Preloaded at boot."]);
  });

  test("two concurrent mutations both land", async () => {
    const demo = fresh();
    await Promise.all([
      mutate(demo, (f) => addComment(f, "design.md", { quote, body: "one", author: "jun" })),
      mutate(demo, (f) => addComment(f, "design.md", { quote, body: "two", author: "jun" })),
    ]);
    expect(readComments(demo).docs["design.md"].map((c) => c.body).sort()).toEqual(["one", "two"]);
  });

  test("leaves no temp files behind", async () => {
    const demo = fresh();
    await mutate(demo, (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }));
    expect(readdirSync(join(demo, ".blackboard"))).toEqual(["comments.json"]);
  });

  test("refuses to overwrite a file it cannot parse", async () => {
    const demo = fresh();
    mkdirSync(join(demo, ".blackboard"));
    writeFileSync(join(demo, ".blackboard", "comments.json"), "{ half written");
    await expect(mutate(demo, (f) => addComment(f, "design.md", { quote, body: "x", author: "jun" }))).rejects.toThrow();
    expect(readFileSync(join(demo, ".blackboard", "comments.json"), "utf8")).toBe("{ half written");
  });

  test("errors on an unknown comment id instead of creating one", async () => {
    const demo = fresh();
    await expect(mutate(demo, (f) => addReply(f, "design.md", "c_missing", { body: "x", author: "jun" }))).rejects.toThrow(/not found/);
  });

  test("puts the file under .blackboard in the board", () => {
    const demo = fresh();
    expect(commentsPath(demo)).toBe(join(demo, ".blackboard", "comments.json"));
  });
});

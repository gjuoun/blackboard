import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommentsStore } from "./comments-store";
import { DocumentsRepo } from "./db/repos/documents";
import { run } from "../test/app";

const quote = { exact: "The cache is warm.", prefix: "Later text. ", suffix: " End." };
/** A temp home; the comment store needs a documents row for its foreign key. */
const fresh = async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "bb-store-")));
  await run(Effect.gen(function* () {
    const docs = yield* DocumentsRepo;
    yield* docs.upsert(home, { id: "testsession", path: join(home, "design.md") });
  }));
  return { home, sid: "testsession", doc: "design.md" };
};

const store = <A>(work: (s: CommentsStore["Service"]) => Effect.Effect<A, { message: string }>): Promise<A> =>
  run(Effect.gen(function* () {
    const s = yield* CommentsStore;
    return yield* work(s);
  }));

describe("review", () => {
  test("refused while a comment has no agent reply", async () => {
    const { home, sid, doc } = await fresh();
    await store((s) => s.add(home, sid, doc, { quote, body: "Why warm?", author: "jun" }));
    const refusal = await store((s) => s.review(home, sid, doc, { round: 1, body: "done", author: "agent" })).then(() => null, (e: Error) => e.message);
    expect(refusal).toMatch(/no reply from agent/);
  });

  test("round is stored after an agent reply", async () => {
    const { home, sid, doc } = await fresh();
    const c = await store((s) => s.add(home, sid, doc, { quote, body: "Why warm?", author: "jun" }));
    await store((s) => s.reply(home, c.id, doc, { body: "Preloaded.", author: "agent" }));
    const r = await store((s) => s.review(home, sid, doc, { round: 1, body: "all answered", author: "agent" }));
    expect(r).toMatchObject({ round: 1, verdict: "commented", body: "all answered", author: "agent", doc });
    const file = await store((s) => s.read(home, sid));
    expect(file.reviews?.[0]).toMatchObject({ round: 1, verdict: "commented" });
  });

  test("a bad round number is refused", async () => {
    const { home, sid, doc } = await fresh();
    const e = await store((s) => s.review(home, sid, doc, { round: 0, body: "x", author: "agent" })).then(() => null, (e: Error) => e.message);
    expect(e).toMatch(/whole number/);
  });
});

describe("comments through the store", () => {
  test("reads as empty when there are no comments yet", async () => {
    const { home, sid } = await fresh();
    expect(await store((s) => s.read(home, sid))).toEqual({ version: 1, docs: {} });
  });

  test("round-trips a comment, a reply and a resolve", async () => {
    const { home, sid, doc } = await fresh();
    const c = await store((s) => s.add(home, sid, doc, { quote, body: "Why warm?", author: "jun" }));
    await store((s) => s.reply(home, c.id, doc, { body: "Preloaded at boot.", author: "agent" }));
    await store((s) => s.setStatus(home, c.id, doc, "resolved", "jun"));
    const stored = (await store((s) => s.read(home, sid))).docs[doc][0];
    expect(stored.quote).toEqual(quote);
    expect(stored.status).toBe("resolved");
    expect(stored.resolvedBy).toBe("jun");
    expect(stored.replies.map((r) => r.body)).toEqual(["Preloaded at boot."]);
    await store((s) => s.setStatus(home, c.id, doc, "open", "jun"));
    const reopened = (await store((s) => s.read(home, sid))).docs[doc][0];
    expect(reopened).toMatchObject({ status: "open", reopenedBy: "jun" });
    expect(reopened.resolvedAt).toBeUndefined();
  });

  test("two concurrent adds both land", async () => {
    const { home, sid, doc } = await fresh();
    await Promise.all([
      store((s) => s.add(home, sid, doc, { quote, body: "one", author: "jun" })),
      store((s) => s.add(home, sid, doc, { quote, body: "two", author: "jun" })),
    ]);
    const list = (await store((s) => s.read(home, sid))).docs[doc];
    expect(list.map((c) => c.body).sort()).toEqual(["one", "two"]);
  });

  test("errors on an unknown comment id instead of creating one", async () => {
    const { home, doc } = await fresh();
    await expect(store((s) => s.reply(home, "c_missing", doc, { body: "x", author: "jun" }))).rejects.toThrow(/not found/);
  });

  test("edits a comment and a reply, stamping editedAt", async () => {
    const { home, sid, doc } = await fresh();
    const c = await store((s) => s.add(home, sid, doc, { quote, body: "typo", author: "jun" }));
    const withReply = await store((s) => s.reply(home, c.id, doc, { body: "re typo", author: "jun" }));
    await store((s) => s.edit(home, c.id, doc, "fixed"));
    await store((s) => s.editReply(home, c.id, withReply.replies[0].id, doc, "re fixed"));
    const stored = (await store((s) => s.read(home, sid))).docs[doc][0];
    expect(stored.body).toBe("fixed");
    expect(stored.editedAt).toBeString();
    expect(stored.replies[0].body).toBe("re fixed");
    expect(stored.replies[0].editedAt).toBeString();
  });

  test("deletes a reply, then the comment", async () => {
    const { home, sid, doc } = await fresh();
    const c = await store((s) => s.add(home, sid, doc, { quote, body: "gone soon", author: "jun" }));
    const keep = await store((s) => s.add(home, sid, doc, { quote, body: "stays", author: "jun" }));
    const r = await store((s) => s.reply(home, c.id, doc, { body: "r", author: "jun" }));
    await store((s) => s.deleteReply(home, c.id, r.replies[0].id, doc));
    expect((await store((s) => s.read(home, sid))).docs[doc].find((x) => x.id === c.id)?.replies).toEqual([]);
    await store((s) => s.remove(home, c.id, doc));
    expect((await store((s) => s.read(home, sid))).docs[doc].map((x) => x.id)).toEqual([keep.id]);
    await store((s) => s.remove(home, keep.id, doc));
    expect((await store((s) => s.read(home, sid))).docs).toEqual({});
  });

  test("reply to a reply id lands on the parent thread", async () => {
    const { home, sid, doc } = await fresh();
    const c = await store((s) => s.add(home, sid, doc, { quote, body: "x", author: "jun" }));
    const first = await store((s) => s.reply(home, c.id, doc, { body: "one", author: "a" }));
    const joined = await store((s) => s.reply(home, c.id, doc, { body: "two", author: "b", joinReplyId: first.replies[0].id }));
    expect(joined.replies).toHaveLength(2);
    await expect(store((s) => s.reply(home, c.id, doc, { body: "bad", author: "a", joinReplyId: "r_missing" }))).rejects.toThrow(/not found/);
  });

  test("open count tracks status changes", async () => {
    const { home, sid, doc } = await fresh();
    const c = await store((s) => s.add(home, sid, doc, { general: true, body: "x", author: "jun" }));
    await store((s) => s.add(home, sid, doc, { general: true, body: "y", author: "jun" }));
    expect(await store((s) => s.countOpen(home, sid))).toBe(2);
    await store((s) => s.setStatus(home, c.id, doc, "resolved", "jun"));
    expect(await store((s) => s.countOpen(home, sid))).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Db, layer as dbLayer } from "./client";
import { DocumentsRepo, layer as documentsLayer } from "./repos/documents";
import { BlocksRepo, layer as blocksLayer } from "./repos/blocks";
import { CommentsRepo, layer as commentsLayer } from "./repos/comments";
import { ReadingStateRepo, layer as readingLayer } from "./repos/reading-state";
import { AgentsRepo, layer as agentsLayer } from "./repos/agents";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-repos-")));
const at = "2026-11-10T00:00:00.000Z";
const quote = { exact: "warm", prefix: "is ", suffix: "." };

/** One program with every repo layer provided, the way a store composes them. */
const run = <A>(effect: Effect.Effect<A, unknown, Db | DocumentsRepo | BlocksRepo | CommentsRepo | ReadingStateRepo | AgentsRepo>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(documentsLayer),
      Effect.provide(blocksLayer),
      Effect.provide(commentsLayer),
      Effect.provide(readingLayer),
      Effect.provide(agentsLayer),
      Effect.provide(dbLayer),
    ),
  );

/** Seed one document so FK-bound children have a parent. */
const seed = (home: string, id = "doc1", path: string | null = "/tmp/doc.md") =>
  run(
    Effect.gen(function* () {
      const docs = yield* DocumentsRepo;
      return yield* docs.upsert(home, { id, path });
    }),
  );

describe("DocumentsRepo", () => {
  test("upsert registers, get/list/remove round-trip, touch refreshes openedAt", async () => {
    const home = fresh();
    const s1 = await seed(home);
    expect(s1.id).toBe("doc1");
    const got = await run(Effect.gen(function* () { const d = yield* DocumentsRepo; return yield* d.get(home, "doc1"); }));
    expect(got?.path).toBe("/tmp/doc.md");
    // re-open same id: path updated, createdAt kept
    const s2 = await run(Effect.gen(function* () { const d = yield* DocumentsRepo; return yield* d.upsert(home, { id: "doc1", path: "/tmp/doc2.md" }); }));
    expect(s2.path).toBe("/tmp/doc2.md");
    expect(s2.createdAt).toBe(s1.createdAt);
    const all = await run(Effect.gen(function* () { const d = yield* DocumentsRepo; return yield* d.list(home); }));
    expect(all).toHaveLength(1);
    const removed = await run(Effect.gen(function* () { const d = yield* DocumentsRepo; return yield* d.remove(home, "doc1"); }));
    expect(removed?.id).toBe("doc1");
    expect(await run(Effect.gen(function* () { const d = yield* DocumentsRepo; return yield* d.get(home, "doc1"); }))).toBeNull();
  });
});

describe("CommentsRepo", () => {
  test("add/list/setStatus/addReply/update/remove and reviews", async () => {
    const home = fresh();
    await seed(home);
    const c = await run(
      Effect.gen(function* () {
        const r = yield* CommentsRepo;
        return yield* r.add(home, {
          id: "c_1", documentId: "doc1", doc: "x.md", anchor: "quote", quote, body: "why?",
          author: "jun", createdAt: at, status: "open", images: null, editedAt: null,
          resolvedAt: null, resolvedBy: null, reopenedAt: null, reopenedBy: null, blockId: null, blockRev: null,
        });
      }),
    );
    expect(c.replies).toEqual([]);
    const withReply = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.addReply(home, "c_1", { id: "r_1", body: "because", author: "agent" }); }));
    expect(withReply?.replies).toHaveLength(1);
    const resolved = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.setStatus(home, "c_1", "resolved", "jun"); }));
    expect(resolved?.resolvedBy).toBe("jun");
    const reopened = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.setStatus(home, "c_1", "open", "jun"); }));
    expect(reopened?.reopenedBy).toBe("jun");
    expect(reopened?.resolvedAt).toBeNull();
    const list = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.list(home, "doc1"); }));
    expect(list).toHaveLength(1);
    const rv = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.addReview(home, { id: "v_1", documentId: "doc1", doc: "x.md", round: 1, body: "done", author: "agent", createdAt: at, verdict: "commented" }); }));
    expect(rv.round).toBe(1);
    const rvs = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.listReviews(home, "doc1"); }));
    expect(rvs).toHaveLength(1);
    const edited = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.update(home, "c_1", "edited"); }));
    expect(edited?.editedAt).not.toBeNull();
    const gone = await run(Effect.gen(function* () { const r = yield* CommentsRepo; return yield* r.remove(home, "c_1"); }));
    expect(gone?.id).toBe("c_1");
  });
});

describe("ReadingStateRepo", () => {
  test("set/get/remove round-trip", async () => {
    const home = fresh();
    await seed(home);
    const row = { documentId: "doc1", status: "reading" as const, progress: 0.5, readAt: at, sourceMtime: 100 };
    await run(Effect.gen(function* () { const r = yield* ReadingStateRepo; return yield* r.set(home, row); }));
    const got = await run(Effect.gen(function* () { const r = yield* ReadingStateRepo; return yield* r.get(home, "doc1"); }));
    expect(got).toEqual(row);
    // upsert over
    await run(Effect.gen(function* () { const r = yield* ReadingStateRepo; return yield* r.set(home, { ...row, status: "read" }); }));
    expect((await run(Effect.gen(function* () { const r = yield* ReadingStateRepo; return yield* r.get(home, "doc1"); })))?.status).toBe("read");
    const removed = await run(Effect.gen(function* () { const r = yield* ReadingStateRepo; return yield* r.remove(home, "doc1"); }));
    expect(removed?.documentId).toBe("doc1");
  });
});

describe("AgentsRepo", () => {
  test("bind/touch/unbind round-trip", async () => {
    const home = fresh();
    await seed(home);
    const bound = await run(Effect.gen(function* () { const a = yield* AgentsRepo; return yield* a.bind(home, { session: "doc1", path: "/tmp/doc.md", piSession: "pi-1", url: "http://127.0.0.1:5" }); }));
    expect(bound.piSession).toBe("pi-1");
    const seen = await run(Effect.gen(function* () { const a = yield* AgentsRepo; yield* a.touch(home, "doc1"); return yield* a.get(home, "doc1"); }));
    expect(seen?.lastSeenAt).not.toBeNull();
    // rebind replaces
    await run(Effect.gen(function* () { const a = yield* AgentsRepo; return yield* a.bind(home, { session: "doc1", path: "/tmp/doc.md", piSession: "pi-2", url: "u" }); }));
    expect((await run(Effect.gen(function* () { const a = yield* AgentsRepo; return yield* a.get(home, "doc1"); })))?.piSession).toBe("pi-2");
    const gone = await run(Effect.gen(function* () { const a = yield* AgentsRepo; return yield* a.unbind(home, "doc1"); }));
    expect(gone?.session).toBe("doc1");
  });
});

describe("BlocksRepo", () => {
  test("append assigns n, list orders by it", async () => {
    const home = fresh();
    await seed(home);
    const b1 = await run(Effect.gen(function* () { const b = yield* BlocksRepo; return yield* b.append(home, { documentId: "doc1", action: "answer", author: "agent", body: "first", images: null, status: null, at }); }));
    const b2 = await run(Effect.gen(function* () { const b = yield* BlocksRepo; return yield* b.append(home, { documentId: "doc1", action: "edit", author: "jun", body: "second", images: null, status: "writing", at }); }));
    expect([b1.n, b2.n]).toEqual([1, 2]);
    const next = await run(Effect.gen(function* () { const b = yield* BlocksRepo; return yield* b.next(home, "doc1"); }));
    expect(next).toBe(3);
    const list = await run(Effect.gen(function* () { const b = yield* BlocksRepo; return yield* b.list(home, "doc1"); }));
    expect(list.map((x) => x.body)).toEqual(["first", "second"]);
  });
});

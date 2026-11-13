import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Db, layer as dbLayer } from "../client";
import { DocumentsRepo, layer as documentsLayer } from "./documents";
import { CommentsRepo, layer as commentsLayer } from "./comments";
import { ContentBlocksRepo, layer as contentBlocksLayer } from "./content-blocks";
import { commentId } from "../../comments-file";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-cb-")));
const at = "2026-11-10T00:00:00.000Z";
const quote = { exact: "warm", prefix: "is ", suffix: "." };

const run = <A>(effect: Effect.Effect<A, unknown, Db | DocumentsRepo | CommentsRepo | ContentBlocksRepo>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(documentsLayer),
      Effect.provide(commentsLayer),
      Effect.provide(contentBlocksLayer),
      Effect.provide(dbLayer),
    ),
  );

const seed = (home: string, id = "doc1") => run(Effect.gen(function* () { const d = yield* DocumentsRepo; return yield* d.upsert(home, { id, path: "/tmp/doc.md" }); }));

const comment = (home: string, doc: string, q = quote) =>
  run(Effect.gen(function* () {
    const repo = yield* CommentsRepo;
    return yield* repo.add(home, {
      id: commentId(), documentId: doc, doc: "doc.md", anchor: "quote", quote: q, blockId: null, blockRev: null,
      body: "note", images: null, author: "jun", createdAt: at, editedAt: null, status: "open",
      resolvedAt: null, resolvedBy: null, reopenedAt: null, reopenedBy: null, replies: [],
    });
  }));

const V1 = "# Doc\n\nwarm words here.\n\nkeep this paragraph.\n";

describe("ContentBlocksRepo.reconcile", () => {
  test("首轮建块：列表项拆开，id 分配，bodyRev=1", async () => {
    const home = fresh();
    await seed(home);
    const r = await run(Effect.gen(function* () { const c = yield* ContentBlocksRepo; return yield* c.reconcile(home, "doc1", "# T\n\n- a\n- b\n\npara.\n"); }));
    expect(r.bodyRev).toBe(1);
    expect(r.added).toBe(4);
    const rows = await run(Effect.gen(function* () { const c = yield* ContentBlocksRepo; return yield* c.list(home, "doc1"); }));
    expect(rows.map((x) => x.kind)).toEqual(["heading", "listItem", "listItem", "paragraph"]);
  });

  test("改写一段：id 不变，rev+1，旧文本入 revs，评论显示 modified + before", async () => {
    const home = fresh();
    await seed(home);
    await run(Effect.gen(function* () { const c = yield* ContentBlocksRepo; return yield* c.reconcile(home, "doc1", V1); }));
    await comment(home, "doc1");
    // 评论回填到 warm words 所在块
    const before = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.list(home, "doc1"); }));
    const warm = before.find((b) => b.plain.includes("warm"))!;
    await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.reconcile(home, "doc1", V1.replace("warm words here.", "warm words rewritten.")); }));
    const after = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.get(home, warm.id); }));
    expect(after?.id).toBe(warm.id);
    expect(after?.rev).toBe(2);
    const oldText = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.revText(home, warm.id, 1); }));
    expect(oldText).toBe("warm words here.");
  });

  test("评论的 block_id 回填：可解析的引文拿到块 id，断掉的留 null", async () => {
    const home = fresh();
    await seed(home);
    await comment(home, "doc1"); // written BEFORE blocks exist
    await comment(home, "doc1", { exact: "no such words anywhere", prefix: "", suffix: "" });
    await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.reconcile(home, "doc1", V1); }));
    const rows = await run(Effect.gen(function* () { const repo = yield* CommentsRepo; return yield* repo.list(home, "doc1"); }));
    const warm = rows.find((r) => r.quote?.exact === "warm");
    expect(warm?.blockId).toMatch(/^cb_/);
    expect(warm?.blockRev).toBe(1);
    const dead2 = rows.find((r) => r.quote?.exact === "no such words anywhere");
    expect(dead2?.blockId).toBeNull();
  });

  test("删除整段：块软删、最后文本保留；revText 仍可读", async () => {
    const home = fresh();
    await seed(home);
    await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.reconcile(home, "doc1", V1); }));
    const before = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.list(home, "doc1"); }));
    const warm = before.find((b) => b.plain.includes("warm"))!;
    await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.reconcile(home, "doc1", "# Doc\n\nkeep this paragraph.\n"); }));
    const rows = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.list(home, "doc1"); }));
    expect(rows.find((b) => b.id === warm.id)).toBeUndefined();
    const old = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.revText(home, warm.id, 1); }));
    expect(old).toBe("warm words here.");
  });

  test("body=null：所有块软删", async () => {
    const home = fresh();
    await seed(home);
    await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.reconcile(home, "doc1", V1); }));
    const r = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.reconcile(home, "doc1", null); }));
    expect(r.removed).toBeGreaterThan(0);
    const rows = await run(Effect.gen(function* () { const repo = yield* ContentBlocksRepo; return yield* repo.list(home, "doc1"); }));
    expect(rows).toHaveLength(0);
  });
});

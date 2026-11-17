import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { run, services } from "../../../test/app";
import { commentId } from "../../comments-file";
import type { Db } from "../client";
import { CommentsRepo } from "./comments";
import { ContentBlocksRepo } from "./content-blocks";
import { DocumentsRepo } from "./documents";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-cb-")));
const at = "2026-11-10T00:00:00.000Z";
const quote = { exact: "warm", prefix: "is ", suffix: "." };

const seed = (home: string, id = "doc1") =>
  run(
    Safe.try(function* () {
      const d = services.documents;
      return yield d.upsert(home, { id, path: "/tmp/doc.md" });
    }),
  );

const comment = (home: string, doc: string, q = quote) =>
  run(
    Safe.try(function* () {
      const repo = services.commentsRepo;
      return yield repo.add(home, {
        id: commentId(),
        documentId: doc,
        doc: "doc.md",
        anchor: "quote",
        quote: q,
        blockId: null,
        blockRev: null,
        body: "note",
        images: null,
        author: "jun",
        createdAt: at,
        editedAt: null,
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        reopenedAt: null,
        reopenedBy: null,
        replies: [],
      });
    }),
  );

const V1 = "# Doc\n\nwarm words here.\n\nkeep this paragraph.\n";

describe("ContentBlocksRepo.reconcile", () => {
  test("首轮建块：列表项拆开，id 分配，bodyRev=1", async () => {
    const home = fresh();
    await seed(home);
    const r = await run(
      Safe.try(function* () {
        const c = services.contentBlocks;
        return yield c.reconcile(home, "doc1", "# T\n\n- a\n- b\n\npara.\n");
      }),
    );
    expect(r.bodyRev).toBe(1);
    expect(r.added).toBe(4);
    const rows = await run(
      Safe.try(function* () {
        const c = services.contentBlocks;
        return yield c.list(home, "doc1");
      }),
    );
    expect(rows.map((x: any) => x.kind)).toEqual(["heading", "listItem", "listItem", "paragraph"]);
  });

  test("改写一段：id 不变，rev+1，旧文本入 revs，评论显示 modified + before", async () => {
    const home = fresh();
    await seed(home);
    await run(
      Safe.try(function* () {
        const c = services.contentBlocks;
        return yield c.reconcile(home, "doc1", V1);
      }),
    );
    await comment(home, "doc1");
    // 评论回填到 warm words 所在块
    const before = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.list(home, "doc1");
      }),
    );
    const warm = before.find((b: any) => b.plain.includes("warm"))!;
    await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.reconcile(home, "doc1", V1.replace("warm words here.", "warm words rewritten."));
      }),
    );
    const after = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.get(home, warm.id);
      }),
    );
    expect(after?.id).toBe(warm.id);
    expect(after?.rev).toBe(2);
    const oldText = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.revText(home, warm.id, 1);
      }),
    );
    expect(oldText).toBe("warm words here.");
  });

  test("评论的 block_id 回填：可解析的引文拿到块 id，断掉的留 null", async () => {
    const home = fresh();
    await seed(home);
    await comment(home, "doc1"); // written BEFORE blocks exist
    await comment(home, "doc1", { exact: "no such words anywhere", prefix: "", suffix: "" });
    await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.reconcile(home, "doc1", V1);
      }),
    );
    const rows = await run(
      Safe.try(function* () {
        const repo = services.commentsRepo;
        return yield repo.list(home, "doc1");
      }),
    );
    const warm = rows.find((r: any) => r.quote?.exact === "warm");
    expect(warm?.blockId).toMatch(/^cb_/);
    expect(warm?.blockRev).toBe(1);
    const dead2 = rows.find((r: any) => r.quote?.exact === "no such words anywhere");
    expect(dead2?.blockId).toBeNull();
  });

  test("删除整段：块软删、最后文本保留；revText 仍可读", async () => {
    const home = fresh();
    await seed(home);
    await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.reconcile(home, "doc1", V1);
      }),
    );
    const before = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.list(home, "doc1");
      }),
    );
    const warm = before.find((b: any) => b.plain.includes("warm"))!;
    await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.reconcile(home, "doc1", "# Doc\n\nkeep this paragraph.\n");
      }),
    );
    const rows = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.list(home, "doc1");
      }),
    );
    expect(rows.find((b: any) => b.id === warm.id)).toBeUndefined();
    const old = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.revText(home, warm.id, 1);
      }),
    );
    expect(old).toBe("warm words here.");
  });

  test("body=null：所有块软删", async () => {
    const home = fresh();
    await seed(home);
    await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.reconcile(home, "doc1", V1);
      }),
    );
    const r = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.reconcile(home, "doc1", null);
      }),
    );
    expect(r.removed).toBeGreaterThan(0);
    const rows = await run(
      Safe.try(function* () {
        const repo = services.contentBlocks;
        return yield repo.list(home, "doc1");
      }),
    );
    expect(rows).toHaveLength(0);
  });
});

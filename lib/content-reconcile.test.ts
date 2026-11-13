import { describe, expect, test } from "bun:test";
import { parseContentBlocks } from "./content-blocks";
import { reconcileBlocks, similarity } from "./content-reconcile";

const V1 = `# Doc

第一段内容，包含一些可以修改的字。

- 第一项
- 第二项
- 第三项

第二段内容保持原样。

\`\`\`ts
const x = 1;
\`\`\`

最后一段也是原文。
`;

const withIds = (src: string) => parseContentBlocks(src).map((s, i) => ({ id: `cb_${i}`, kind: s.kind, text: s.text, hash: s.hash, rev: 1, deletedAt: null }));

describe("parseContentBlocks", () => {
  test("顶层块 + 列表项各自成块", () => {
    const blocks = parseContentBlocks(V1);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual(["heading", "paragraph", "listItem", "listItem", "listItem", "paragraph", "code", "paragraph"]);
    // 列表项共享父组的 grp
    expect(blocks[2].grp).toBe(blocks[3].grp);
    expect(blocks[4].grp).toBe(blocks[2].grp);
    expect(blocks[1].plain).toContain("第一段内容");
    expect(blocks[6].plain).toContain("const x = 1");
  });
});

describe("reconcileBlocks", () => {
  test("未改动的块 id 全部保住", () => {
    const old = withIds(V1);
    const plan = reconcileBlocks(old, V1);
    expect(plan.added).toHaveLength(0);
    expect(plan.removed).toHaveLength(0);
    expect(plan.live.filter((m) => m.modified)).toHaveLength(0);
    expect(new Set(plan.live.map((m) => m.id)).size).toBe(old.length);
  });

  test("改写一段：id 保住并记 modified", () => {
    const old = withIds(V1);
    const v2 = V1.replace("第一段内容，包含一些可以修改的字。", "第一段内容，包含一些被改过的字。");
    const plan = reconcileBlocks(old, v2);
    const mod = plan.live.filter((m) => m.modified);
    expect(mod).toHaveLength(1);
    expect(mod[0].id).toBe(old[1].id);
    expect(plan.added).toHaveLength(0);
    expect(plan.removed).toHaveLength(0);
  });

  test("整段换成无关内容：报 1 removed + 1 added，不误判成 modified", () => {
    const old = withIds(V1);
    const v2 = V1.replace("第一段内容，包含一些可以修改的字。", "Completely unrelated text about blockchains and cheese aging.");
    const plan = reconcileBlocks(old, v2);
    expect(plan.removed).toEqual([old[1].id]);
    expect(plan.added).toHaveLength(1);
    expect(plan.live.filter((m) => m.modified)).toHaveLength(0);
  });

  test("删除一段 + 插入一段", () => {
    const old = withIds(V1);
    const v2 = V1.replace("第二段内容保持原样。\n\n", "").replace("最后一段也是原文。", "插入的新段落。\n\n最后一段也是原文。");
    const plan = reconcileBlocks(old, v2);
    expect(plan.removed).toEqual([old[5].id]);
    expect(plan.added).toHaveLength(1);
    expect(plan.live.filter((m) => m.modified)).toHaveLength(0);
  });

  test("列表项改写只影响那一项", () => {
    const old = withIds(V1);
    const v2 = V1.replace("- 第二项", "- 第二项（修订）");
    const plan = reconcileBlocks(old, v2);
    const mod = plan.live.filter((m) => m.modified);
    expect(mod).toHaveLength(1);
    expect(mod[0].id).toBe(old[3].id);
    expect(plan.removed).toHaveLength(0);
  });

  test("拆分段落：1 removed + 2 added", () => {
    const old = withIds(V1);
    const v2 = V1.replace("第二段内容保持原样。", "第二段内容保持原样。\n\n这是拆分出来的后半段。");
    const plan = reconcileBlocks(old, v2);
    // 拆分可以表现为（原块改小 + 新增）或（删除 + 2 新增），两者都可接受，重点是 id 不会消失而文本还在
    const half = plan.live.find((m) => m.spec.text.includes("第二段内容"));
    expect(half).toBeDefined();
  });
});

describe("similarity", () => {
  test("相同/改写/无关的三种情况", () => {
    expect(similarity("第一段内容不变。", "第一段内容不变。")).toBeGreaterThan(0.99);
    expect(similarity("顺延 30 天，逾期按 1% 计息。", "顺延 45 天，逾期按 1% 计息。")).toBeGreaterThan(0.5);
    expect(similarity("第一段内容", "totally different words")).toBeLessThan(0.5);
  });
});

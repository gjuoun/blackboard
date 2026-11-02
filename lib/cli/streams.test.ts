import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../test/app";
import { runCli, setup } from "../../test/fixtures/cli";
import { close } from "./sessions";
import { appendBlock, editBlock, exportBlocks, setHeader } from "./streams";

describe("block writer", () => {
  test("review: CLI refuses while a comment has no agent reply, then stores the round", () => {
    const { home, design } = setup();
    expect(runCli(home, ["open", "--no-browser", design]).code).toBe(0);
    expect(runCli(home, ["comment", design, "--quote", "Later text.", "why?"]).code).toBe(0);
    const refused = runCli(home, ["review", design, "--round", "1", "all done"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("no reply from agent");
    const id = JSON.parse(runCli(home, ["comments", design, "--json"]).out)[0].id;
    expect(runCli(home, ["reply", design, id, "answered"]).code).toBe(0);
    const ok = runCli(home, ["review", design, "--round", "1", "all done"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("commented");
  }, 30_000);

  test("general: CLI creates one", () => {
    const { home, design } = setup();
    expect(runCli(home, ["open", "--no-browser", design]).code).toBe(0);
    const r = runCli(home, ["comment", design, "--general", "an independent note"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("(general)");
    expect(runCli(home, ["comments", design]).out).toContain("(general)");
  }, 30_000);

  test("open --kind stream --title writes the metadata line", () => {
    const { home, docs } = setup();
    writeFileSync(join(docs, "log.jsonl"), "");
    expect(runCli(home, ["open", "--no-browser", "--kind", "stream", "--title", "标题", "log.jsonl"], docs).code).toBe(0);
    const lines = readFileSync(join(docs, "log.jsonl"), "utf8").split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "meta", v: 1, title: "标题", kind: "stream", owner: "agent" });
  }, 30_000);

  test("block: edit keeps the id and rewrites the body", async () => {
    const { home, docs } = setup();
    writeFileSync(join(docs, "log.jsonl"), "");
    expect(runCli(home, ["open", "--no-browser", "--kind", "stream", "log.jsonl"], docs).code).toBe(0);
    const first = runCli(home, ["block", "log.jsonl", "--action", "answer", "draft", "--json"], docs);
    const made = JSON.parse(first.out);
    expect(made.id).toMatch(/^b-/);
    // The CLI hands out the block's own address, so an agent can paste it into a chat.
    expect(made.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:38770/s/[0-9a-f]{10}#${made.id}$`));
    const r = runCli(home, ["block", "log.jsonl", "--edit", made.id, "final"], docs);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`#${made.id}`);
    const lines = readFileSync(join(docs, "log.jsonl"), "utf8").trim().split("\n");
    // line 1 is the metadata line open wrote; the block follows it
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "meta" });
    expect(JSON.parse(lines[1])).toMatchObject({ type: "block", id: made.id, body: "final" });
  }, 30_000);

  test("block: appends one block line after the metadata", () => {
    const { home, docs } = setup();
    writeFileSync(join(docs, "log.jsonl"), "");
    expect(runCli(home, ["open", "--no-browser", "--kind", "stream", "log.jsonl"], docs).code).toBe(0);
    const r = runCli(home, ["block", "log.jsonl", "--action", "answer", "### Heading\n\nBody"], docs);
    expect(r.code).toBe(0);
    const lines = readFileSync(join(docs, "log.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "meta" });
    const block = JSON.parse(lines[1]);
    expect(block).toMatchObject({ type: "block", n: 1, action: "answer", author: "agent" });
    // The second line is the address of the block just written: the chat-ready link.
    const [first, url] = r.out.trimEnd().split("\n");
    expect(first).toBe(`block 1 (${block.id}) appended to ${join(docs, "log.jsonl")}`);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:38770\/s\/[0-9a-f]{10}#b-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(url.endsWith(`#${block.id}`)).toBe(true);
    const exp = runCli(home, ["export", "log.jsonl"], docs);
    expect(exp.out).toContain("## 1. 长答 · agent");
  }, 30_000);

  test("header: migrates an old file, keeps its blocks and is idempotent", () => {
    const { home, docs } = setup();
    const old = [
      JSON.stringify({ id: "b1", n: 1, action: "answer", author: "agent", at: "t1", body: "one" }),
      JSON.stringify({ id: "b2", n: 2, action: "append", author: "agent", at: "t2", body: "two" }),
    ].join("\n") + "\n";
    writeFileSync(join(docs, "log.jsonl"), old);
    // register without touching the existing blocks
    expect(runCli(home, ["open", "--no-browser", "--kind", "stream", "log.jsonl"], docs).code).toBe(0);
    expect(readFileSync(join(docs, "log.jsonl"), "utf8")).toBe(old);

    const first = runCli(home, ["header", "log.jsonl", "--title", "老会话", "--owner", "jun"], docs);
    expect(first.code).toBe(0);
    expect(first.out).toContain("written");
    const after = readFileSync(join(docs, "log.jsonl"), "utf8");
    expect(after.endsWith(old)).toBe(true);
    const meta = JSON.parse(after.split("\n")[0]);
    expect(meta).toMatchObject({ type: "meta", v: 1, title: "老会话", kind: "stream", owner: "jun" });

    const second = runCli(home, ["header", "log.jsonl", "--title", "老会话", "--owner", "jun"], docs);
    expect(second.code).toBe(0);
    expect(second.out).toContain("updated");
    expect(readFileSync(join(docs, "log.jsonl"), "utf8")).toBe(after);

    const exp = runCli(home, ["export", "log.jsonl"], docs);
    expect(exp.out.startsWith("# 老会话\n")).toBe(true);
    expect(exp.out.match(/^## /gm)).toHaveLength(2);
  }, 30_000);

  test("block: refused on a doc session", () => {
    const { home, design } = setup();
    expect(runCli(home, ["open", "--no-browser", design]).code).toBe(0);
    const r = runCli(home, ["block", design, "--action", "answer", "x"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("is not a stream");
  }, 30_000);

  test("streams service: append, edit, header and export round-trip", async () => {
    const { home, docs } = setup();
    writeFileSync(join(docs, "log.jsonl"), "");
    expect(runCli(home, ["open", "--no-browser", "--kind", "stream", "log.jsonl"], docs).code).toBe(0);
    const made = await run(appendBlock(home, join(docs, "log.jsonl"), { action: "answer", text: "one", author: "agent" }));
    expect(made.n).toBe(1);
    await run(editBlock(home, join(docs, "log.jsonl"), made.id, "two"));
    await run(setHeader(home, join(docs, "log.jsonl"), { title: "标题" }));
    const md = await run(exportBlocks(home, join(docs, "log.jsonl")));
    expect(md.startsWith("# 标题")).toBe(true);
    expect(md).toContain("two");
    await run(close(home, join(docs, "log.jsonl")));
  }, 30_000);
});
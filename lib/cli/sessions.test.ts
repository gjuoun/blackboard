import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../test/app";
import { setup } from "../../test/fixtures/cli";
import { comment } from "./comments";
import { blockUrl, close, open, sessions } from "./sessions";

describe("open", () => {
  test("open is idempotent", async () => {
    const { home, design } = setup();
    const a = await run(open(home, design));
    const b = await run(open(home, design));
    expect(b.session.id).toBe(a.session.id);
    expect(a.url).toBe(`http://127.0.0.1:38770/s/${a.session.id}`);
    expect((await run(sessions(home))).map((s) => s.title)).toEqual(["Design"]);
  });

  test("open: jsonl needs --kind stream", async () => {
    const { home, docs } = setup();
    writeFileSync(join(docs, "log.jsonl"), "");
    await expect(run(open(home, join(docs, "log.jsonl")))).rejects.toThrow(/needs --kind stream/);
    expect((await run(open(home, join(docs, "log.jsonl"), docs, "stream"))).session.kind).toBe("stream");
  });

  test("blockUrl: the session URL plus the block id, base from $BLACKBOARD_URL", () => {
    const before = process.env.BLACKBOARD_URL;
    expect(blockUrl("1f09747876", "b-01M6EM3GQS6TXPTABZK16YT1RV")).toBe("http://127.0.0.1:38770/s/1f09747876#b-01M6EM3GQS6TXPTABZK16YT1RV");
    process.env.BLACKBOARD_URL = "http://192.168.4.20:4000/";
    expect(blockUrl("abc123", "b-1")).toBe("http://192.168.4.20:4000/s/abc123#b-1");
    if (before === undefined) delete process.env.BLACKBOARD_URL;
    else process.env.BLACKBOARD_URL = before;
  });

  test("open refuses what is not a markdown file", async () => {
    const { home, docs } = setup();
    await expect(run(open(home, docs))).rejects.toThrow(/not a markdown file/);
  });
});

describe("close", () => {
  test("close forgets the session but keeps its comments for a later open", async () => {
    const { home, design } = setup();
    const { session } = await run(open(home, design));
    await run(comment(home, design, "Later text.", "keep me", "jun"));
    await run(close(home, design));
    expect(await run(sessions(home))).toEqual([]);
    expect(session.id).toBe((await run(open(home, design))).session.id);
  });
});

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../test/app";
import { setup } from "../../test/fixtures/cli";
import { comment } from "./comments";
import { close, open, sessions } from "./sessions";

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

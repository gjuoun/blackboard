import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../test/app";
import { repoSetup, runCli, setup } from "../../test/fixtures/cli";
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

describe("open --kind pr", () => {
  test("fills the front matter once, pins the merge-base and reports the pin", async () => {
    const { home, repo, design } = repoSetup();
    const first = await run(open(home, design, repo, "pr"));
    expect(first.pr?.base).toBe("main");
    expect(first.pr?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.pr?.filled).toBe(true);
    const written = readFileSync(design, "utf8");
    expect(written).toContain("kind: pr");
    expect(written).toContain("  base: main");
    expect(written).toContain("  base_sha: " + first.pr!.sha);

    const second = await run(open(home, design, repo, "pr"));
    expect(second.pr?.filled).toBe(false);
    expect(second.pr?.sha).toBe(first.pr!.sha);
    expect(readFileSync(design, "utf8")).toBe(written);
    expect((await run(sessions(home))).find((s) => s.id === first.session.id)?.kind).toBe("pr");
  });

  test("refuses a base_sha git cannot resolve", async () => {
    const { home, repo, design } = repoSetup();
    writeFileSync(design, "---\ntitle: Review\nkind: pr\npr:\n  base: main\n  base_sha: deadbeef\n---\n\n# Review\n");
    await expect(run(open(home, design, repo, "pr"))).rejects.toThrow(/base_sha/);
  });

  test("refuses a pr doc outside a git repository", async () => {
    const { home, design } = setup();
    await expect(run(open(home, design, process.cwd(), "pr"))).rejects.toThrow(/not inside a git repository/);
  });

  test("the binary accepts --kind pr and rejects any other value", () => {
    const { home, repo, design } = repoSetup();
    const opened = runCli(home, ["open", "--no-browser", "--kind", "pr", design], repo);
    expect(opened.code).toBe(0);
    expect(opened.out).toContain("pr base main @");
    expect(opened.out).toContain("front matter filled");
    const rows = JSON.parse(runCli(home, ["sessions", "--json"]).out);
    expect(rows[0].kind).toBe("pr");
    expect(runCli(home, ["sessions"]).out).toContain("  pr");
    expect(runCli(home, ["open", "--no-browser", "--kind", "cloud", design], repo).code).toBe(2);
  }, 30_000);
});
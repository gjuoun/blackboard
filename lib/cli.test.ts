import { describe, expect, test } from "bun:test";
import { runCli, setup } from "../test/fixtures/cli";

describe("blackboard binary", () => {
  test("open prints id and url; comment by a relative path from the doc folder; exit codes follow the contract", () => {
    const { home, docs } = setup();
    const opened = runCli(home, ["open", "--no-browser", "design.md"], docs);
    expect(opened.code).toBe(0);
    const [id, url] = opened.out.trim().split(/\s+/);
    expect(url).toBe(`http://127.0.0.1:38770/s/${id}`);

    const made = runCli(home, ["comment", "design.md", "--quote", "Later text.", "--author", "agent", "please", "explain"], docs);
    expect(made.code).toBe(0);
    const listed = runCli(home, ["comments", id, "--json"]);
    expect(JSON.parse(listed.out).map((c: { body: string; author: string }) => `${c.author}:${c.body}`)).toEqual(["agent:please explain"]);
    const rows = JSON.parse(runCli(home, ["sessions", "--json"]).out);
    expect(rows.map((r: { title: string; open: number }) => `${r.title}:${r.open}`)).toEqual(["Design:1"]);

    expect(runCli(home, ["comments", "nope"]).code).toBe(1);
    expect(runCli(home, ["open", "--no-browser", docs]).code).toBe(1);
    expect(runCli(home, ["reply", id]).code).toBe(2);
    expect(runCli(home, ["frobnicate"]).code).toBe(2);
  }, 30_000);
});
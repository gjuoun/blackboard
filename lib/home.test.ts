import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandHome, getHome } from "./home";

const saved = { home: process.env.HOME, bb: process.env.BLACKBOARD_HOME };
afterEach(() => {
  process.env.HOME = saved.home;
  if (saved.bb === undefined) delete process.env.BLACKBOARD_HOME;
  else process.env.BLACKBOARD_HOME = saved.bb;
});

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-home-")));

describe("getHome", () => {
  test("an explicit folder wins and is created", () => {
    const dir = join(tmp(), "explicit");
    process.env.BLACKBOARD_HOME = join(tmp(), "env");
    expect(getHome(dir)).toBe(dir);
    expect(existsSync(dir)).toBe(true);
  });

  test("BLACKBOARD_HOME is used when nothing is passed", () => {
    const dir = join(tmp(), "env");
    process.env.BLACKBOARD_HOME = dir;
    expect(getHome()).toBe(dir);
  });

  test("defaults to ~/.blackboard", () => {
    const fakeHome = tmp();
    process.env.HOME = fakeHome;
    delete process.env.BLACKBOARD_HOME;
    expect(getHome()).toBe(join(fakeHome, ".blackboard"));
  });

  test("expands a leading ~", () => {
    const fakeHome = tmp();
    process.env.HOME = fakeHome;
    expect(expandHome("~/docs/a.md")).toBe(join(fakeHome, "docs/a.md"));
    expect(expandHome("/abs/~/a.md")).toBe("/abs/~/a.md");
  });
});

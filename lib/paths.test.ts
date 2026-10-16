import { describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveSafe } from "./paths";
import { makeFixtureRoot } from "./test-fixture";

const { base, root, demo } = makeFixtureRoot();

describe("resolveSafe", () => {
  test("resolves a doc inside the root", () => {
    expect(resolveSafe(root, "demo/design.md")).toBe(join(demo, "design.md"));
  });

  test("resolves a path that does not exist yet inside the root", () => {
    expect(resolveSafe(root, "demo/.blackboard/comments.json")).toBe(join(demo, ".blackboard", "comments.json"));
  });

  test("rejects ../ escape", () => {
    expect(resolveSafe(root, "demo/../../outside.md")).toBeNull();
    expect(resolveSafe(root, "..")).toBeNull();
  });

  test("rejects absolute paths", () => {
    expect(resolveSafe(root, "/etc/passwd")).toBeNull();
  });

  test("rejects symlink escape", () => {
    expect(resolveSafe(root, "demo/escape.md")).toBeNull();
    expect(resolveSafe(root, "demo/escape-dir/outside.md")).toBeNull();
  });

  test("rejects a dangling symlink, which a write would follow out of the root", () => {
    symlinkSync(join(base, "not-yet.md"), join(demo, "dangling.md"));
    expect(resolveSafe(root, "demo/dangling.md")).toBeNull();
  });

  test("rejects NUL bytes", () => {
    expect(resolveSafe(root, "demo/design.md\0.png")).toBeNull();
  });
});

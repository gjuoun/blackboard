import { describe, expect, test } from "bun:test";
import { LEFT_TABS_BY_TYPE, parseLeftTab } from "./left-rail";

describe("left rail", () => {
  test("left: doc starts on contents", () => {
    expect(parseLeftTab(undefined, "doc")).toBe("contents");
    expect(LEFT_TABS_BY_TYPE.doc).toEqual(["contents", "workspace"]);
  });

  test("left: code has only the tree", () => {
    expect(LEFT_TABS_BY_TYPE.code).toEqual(["workspace"]);
    expect(parseLeftTab("contents", "code")).toBe("workspace");
  });

  test("left: unknown tab falls back", () => {
    expect(parseLeftTab("outline", "code")).toBe("workspace");
    expect(parseLeftTab("bogus", "doc")).toBe("contents");
  });

  test("left: stream shows timeline only", () => {
    expect(LEFT_TABS_BY_TYPE.stream).toEqual(["timeline"]);
    expect(parseLeftTab("workspace", "stream")).toBe("timeline");
  });
});

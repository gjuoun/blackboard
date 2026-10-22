import { describe, expect, test } from "bun:test";
import { closeTab, MAX_TABS, moveTab, openTab, parseTabs, removeTab, serializeTabs, type Tab } from "./tabs";

const t = (id: string, title = id.toUpperCase()): Tab => ({ id, title, path: `/docs/${id}.md` });

describe("openTab", () => {
  test("appends a new tab and updates an existing one in place", () => {
    let tabs = openTab([], t("a"));
    tabs = openTab(tabs, t("b"));
    tabs = openTab(tabs, { ...t("a"), title: "A renamed" });
    expect(tabs.map((x) => `${x.id}:${x.title}`)).toEqual(["a:A renamed", "b:B"]);
  });

  test("returns the same array when nothing changed, so a re-render does not loop", () => {
    const tabs = [t("a")];
    expect(openTab(tabs, t("a"))).toBe(tabs);
  });

  test("keeps at most MAX_TABS, dropping the oldest", () => {
    let tabs: Tab[] = [];
    for (let i = 0; i < MAX_TABS + 3; i++) tabs = openTab(tabs, t(`d${i}`));
    expect(tabs).toHaveLength(MAX_TABS);
    expect(tabs[0].id).toBe("d3");
  });
});

describe("closeTab", () => {
  test("closing the active tab activates the right neighbour", () => {
    expect(closeTab([t("a"), t("b"), t("c")], "b", "b")).toEqual({ tabs: [t("a"), t("c")], next: "c" });
  });

  test("the last tab falls back to its left neighbour, then to Home", () => {
    expect(closeTab([t("a"), t("b")], "b", "b").next).toBe("a");
    expect(closeTab([t("a")], "a", "a").next).toBeNull();
  });

  test("closing a background tab keeps the active one", () => {
    expect(closeTab([t("a"), t("b")], "a", "b").next).toBe("b");
    expect(closeTab([t("a"), t("b")], "a", null).next).toBeNull();
  });
});

describe("moveTab", () => {
  const t = (id: string) => ({ id, title: id });
  const abc = [t("a"), t("b"), t("c")];
  const ids = (tabs: { id: string }[]) => tabs.map((x) => x.id).join("");
  test("moves a tab before another, or to the end", () => {
    expect(ids(moveTab(abc, "c", "a"))).toBe("cab");
    expect(ids(moveTab(abc, "a", "c"))).toBe("bac");
    expect(ids(moveTab(abc, "a", null))).toBe("bca");
  });
  test("a drop that changes nothing returns the same array", () => {
    expect(moveTab(abc, "b", "b")).toBe(abc);
    expect(moveTab(abc, "b", "c")).toBe(abc);
    expect(moveTab(abc, "c", null)).toBe(abc);
  });
  test("unknown ids leave the order alone", () => {
    expect(moveTab(abc, "x", "a")).toBe(abc);
    expect(moveTab(abc, "a", "x")).toBe(abc);
  });
});

describe("persistence", () => {
  test("round-trips and drops junk", () => {
    const tabs = [t("a"), t("b")];
    expect(parseTabs(serializeTabs(tabs))).toEqual(tabs);
    expect(parseTabs(null)).toEqual([]);
    expect(parseTabs("{oops")).toEqual([]);
    expect(parseTabs(JSON.stringify([{ id: "a", title: "A" }, { id: 3 }, "x", { id: "a", title: "dup" }, { id: "../x", title: "bad" }]))).toEqual([
      { id: "a", title: "A" },
    ]);
  });

  test("removeTab drops one tab", () => {
    expect(removeTab([t("a"), t("b")], "a")).toEqual([t("b")]);
  });
});

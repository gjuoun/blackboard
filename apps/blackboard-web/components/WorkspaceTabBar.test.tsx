import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isWorkspaceView, VIEW_FILTERS, WorkspaceTabBar, WORKSPACE_VIEWS } from "./WorkspaceTabBar";

describe("WorkspaceTabBar", () => {
  test("renders the five tabs in order: inbox filters, then New and Settings", () => {
    const html = renderToStaticMarkup(<WorkspaceTabBar view="all" onView={() => {}} />);
    expect(html).toContain('data-testid="rw-tabbar"');
    for (const key of WORKSPACE_VIEWS) expect(html).toContain(`data-tab="${key}"`);
    expect(html.indexOf('data-tab="all"')).toBeLessThan(html.indexOf('data-tab="unread"'));
    expect(html.indexOf('data-tab="unread"')).toBeLessThan(html.indexOf('data-tab="reading"'));
    expect(html.indexOf('data-tab="reading"')).toBeLessThan(html.indexOf('data-tab="new"'));
    expect(html.indexOf('data-tab="new"')).toBeLessThan(html.indexOf('data-tab="settings"'));
    expect(html).toContain("Inbox");
    expect(html).toContain("Unread");
    expect(html).toContain("Reading");
    expect(html).toContain("New");
    expect(html).toContain("Settings");
  });

  test("the active view carries aria-current", () => {
    expect(renderToStaticMarkup(<WorkspaceTabBar view="reading" onView={() => {}} />)).toContain('data-tab="reading" aria-current="true"');
    expect(renderToStaticMarkup(<WorkspaceTabBar view="all" onView={() => {}} />)).toContain('data-tab="reading" aria-current="false"');
  });

  test("the first three views are the reading filters; new and settings are screens", () => {
    expect(VIEW_FILTERS).toEqual({ all: "all", unread: "unread", reading: "reading" });
    expect(isWorkspaceView("unread")).toBe(true);
    expect(isWorkspaceView("settings")).toBe(true);
    expect(isWorkspaceView("bogus")).toBe(false);
    expect(isWorkspaceView(null)).toBe(false);
  });
});

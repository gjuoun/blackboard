import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isWorkspaceView, VIEW_FILTERS, WorkspaceTabBar, WORKSPACE_VIEWS } from "./WorkspaceTabBar";

describe("WorkspaceTabBar", () => {
  test("renders the three tabs in order: inbox filters, then Settings", () => {
    const html = renderToStaticMarkup(<WorkspaceTabBar view="all" onView={() => {}} />);
    expect(html).toContain('data-testid="rw-tabbar"');
    for (const key of WORKSPACE_VIEWS) expect(html).toContain(`data-tab="${key}"`);
    expect(html.indexOf('data-tab="all"')).toBeLessThan(html.indexOf('data-tab="unread"'));
    expect(html.indexOf('data-tab="unread"')).toBeLessThan(html.indexOf('data-tab="settings"'));
    expect(html).toContain("Inbox");
    expect(html).toContain("Unread");
    expect(html).toContain("Settings");
    // The mailbox is one-way: there is no "New" screen to compose into.
    expect(html).not.toContain('data-tab="new"');
    expect(html).not.toContain(">New<");
  });

  test("the active view carries aria-current", () => {
    expect(renderToStaticMarkup(<WorkspaceTabBar view="unread" onView={() => {}} />)).toContain('data-tab="unread" aria-current="true"');
    expect(renderToStaticMarkup(<WorkspaceTabBar view="all" onView={() => {}} />)).toContain('data-tab="unread" aria-current="false"');
  });

  test("the first two views are the reading filters; settings is a screen", () => {
    expect(VIEW_FILTERS).toEqual({ all: "all", unread: "unread" });
    expect(isWorkspaceView("unread")).toBe(true);
    expect(isWorkspaceView("settings")).toBe(true);
    expect(isWorkspaceView("bogus")).toBe(false);
    expect(isWorkspaceView(null)).toBe(false);
  });
});

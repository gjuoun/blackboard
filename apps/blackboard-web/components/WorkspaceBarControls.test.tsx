import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The controls read the bar the inbox page publishes; the store is seeded with a fixed snapshot.
mock.module("./workspace-bar", () => ({
  useWorkspaceBar: () => ({
    query: "",
    onQuery() {},
    repo: "",
    repos: ["blackboard"],
    onRepo() {},
    filter: "all",
    onFilter() {},
    counts: { total: 3, unread: 2, reading: 1, read: 0 },
    pending: 4,
  }),
}));

import { TestNav } from "@/test/nav";
import { WorkspaceBarControls } from "./WorkspaceBarControls";

const html = () =>
  renderToStaticMarkup(
    <TestNav>
      <WorkspaceBarControls />
    </TestNav>,
  );

describe("WorkspaceBarControls", () => {
  test("the breadcrumb names the page Inbox and the gear opens its settings", () => {
    const out = html();
    expect(out).toContain(">Inbox</span>");
    expect(out).toContain('href="/inbox/settings"');
    expect(out).not.toContain("Reading workspace");
  });

  test("the repo filter hides the native arrow and draws its own inside the border", () => {
    const out = html();
    expect(out).toContain('aria-label="Filter by repository"');
    // appearance-none kills the UA arrow; the lucide chevron inside the relative wrapper replaces it.
    expect(out).toContain("appearance-none");
    expect(out).toContain("pointer-events-none");
    expect(out).toMatch(/relative[^>]*>[^]*aria-label="Filter by repository"/);
  });
});

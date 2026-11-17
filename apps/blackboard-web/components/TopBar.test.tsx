import { describe, expect, mock, test } from "bun:test";

// TopBar is a client component; its router arrives through a Nav, and the chrome store is
// replaced with a controllable snapshot so each render sees a different open doc.
let pathname = "/inbox";
let desktop = true;
let chromeState: {
  tocOpen: boolean;
  cmOpen: boolean;
  sheet: string | null;
  doc: Record<string, unknown> | null;
};
mock.module("./chrome", () => ({
  setChrome: () => {},
  togglePanel: () => {},
  resetReading: () => {},
  useChrome: () => chromeState,
  useIsDesktop: () => desktop,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { TestNav } from "@/test/nav";
import { TopBar } from "./TopBar";

const DOC = { id: "118d065fcf", path: "/x.md", title: "Doc", readable: true, hasToc: true, open: 2 } as const;

/** Render the bar with one open doc (or none on the inbox) and return its markup. */
function render(doc: Record<string, unknown> | null, over: { desktop?: boolean; path?: string } = {}) {
  pathname = over.path ?? (doc ? `/s/${doc.id}` : "/inbox");
  desktop = over.desktop ?? true;
  chromeState = { tocOpen: true, cmOpen: true, sheet: null, doc };
  return renderToStaticMarkup(
    <TestNav pathname={pathname}>
      <TopBar />
    </TestNav>,
  );
}

describe("TopBar doc toggles", () => {
  test("a doc page shows both toggles, on desktop and on a phone", () => {
    for (const width of [true, false]) {
      const html = render({ ...DOC }, { desktop: width });
      expect(html).toContain('data-testid="toggle-comments"');
      expect(html).toContain('data-testid="toggle-toc"');
    }
  });

  test("the comments badge rides the toggle", () => {
    const html = render({ ...DOC, open: 3 });
    expect(html).toContain('data-testid="toggle-comments"');
    expect(html).toMatch(/data-testid="toggle-comments"[\s\S]*<span[^>]*>3<\/span>/);
  });

  test("a doc with one section keeps comments only", () => {
    const code = render({ ...DOC, hasToc: false, open: 0 });
    expect(code).toContain('data-testid="toggle-comments"');
    expect(code).not.toContain('data-testid="toggle-toc"');
  });

  test("the inbox has no doc toggles", () => {
    const html = render(null, { path: "/inbox" });
    expect(html).not.toContain('data-testid="toggle-comments"');
    expect(html).not.toContain('data-testid="toggle-toc"');
  });

  test("a /s/<non-id> path has no doc toggles", () => {
    const html = render({ ...DOC, id: "118d065fcf" }, { path: "/s/not-a-session" });
    expect(html).not.toContain('data-testid="toggle-comments"');
    expect(html).not.toContain('data-testid="toggle-toc"');
  });

  test("the inbox merges its controls into the one bar; other pages get a back link", () => {
    const inbox = render(null, { path: "/inbox" });
    expect(inbox).toContain('data-testid="rw-header"');
    expect(inbox).not.toContain('data-testid="back-to-inbox"');
    const settings = render(null, { path: "/inbox/settings" });
    expect(settings).toContain('data-testid="back-to-inbox"');
  });
});

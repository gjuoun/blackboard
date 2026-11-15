import { describe, expect, mock, test } from "bun:test";

// TopBar is a client component; outside Next its router use is mocked, and the chrome store is
// replaced with a controllable snapshot so each render sees a different open doc.
let pathname = "/";
let desktop = true;
let chromeState: { tocOpen: boolean; cmOpen: boolean; sheet: string | null; doc: Record<string, unknown> | null };
mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
  usePathname: () => pathname,
}));
mock.module("next/link", () => ({
  Link: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a>,
}));
mock.module("./chrome", () => ({
  setChrome: () => {},
  togglePanel: () => {},
  resetReading: () => {},
  useChrome: () => chromeState,
  useIsDesktop: () => desktop,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { TopBar } from "./TopBar";

const DOC = { id: "118d065fcf", path: "/x.md", readable: true, hasToc: true, open: 2 } as const;
const STREAM_DOC = { ...DOC, id: "s-01M720SVVSKX0H7QGKNFRYC2JD" };

/** Render the bar with one open doc (or none on Home) and return its markup. */
function render(doc: Record<string, unknown> | null, over: { desktop?: boolean; path?: string } = {}) {
  pathname = over.path ?? (doc ? `/s/${doc.id}` : "/");
  desktop = over.desktop ?? true;
  chromeState = { tocOpen: true, cmOpen: true, sheet: null, doc };
  return renderToStaticMarkup(<TopBar />);
}

describe("TopBar doc toggles", () => {
  test("a doc page shows both toggles, on desktop and on a phone", () => {
    for (const width of [true, false]) {
      const html = render({ ...DOC }, { desktop: width });
      expect(html).toContain('data-testid="toggle-comments"');
      expect(html).toContain('data-testid="toggle-toc"');
      expect(html).not.toContain("open-timeline");
    }
  });

  test("the comments badge rides the toggle", () => {
    const html = render({ ...DOC, open: 3 });
    expect(html).toContain('data-testid="toggle-comments"');
    expect(html).toMatch(/data-testid="toggle-comments"[\s\S]*<span[^>]*>3<\/span>/);
  });

  test("a code page keeps comments only, with no timeline icon", () => {
    const code = render({ ...DOC, id: "22cc33aa00", readable: true, hasToc: false, open: 0 });
    expect(code).toContain('data-testid="toggle-comments"');
    expect(code).not.toContain('data-testid="toggle-toc"');
    expect(code).not.toContain("open-timeline");
  });

  test("Home has no doc toggles", () => {
    const html = render(null, { path: "/" });
    expect(html).not.toContain('data-testid="toggle-comments"');
    expect(html).not.toContain('data-testid="toggle-toc"');
    expect(html).not.toContain("open-timeline");
  });

  test("a streamed doc page shows the same toggles as a file doc", () => {
    const html = render({ ...STREAM_DOC, open: 1 });
    expect(html).toContain('data-testid="toggle-comments"');
    expect(html).toContain('data-testid="toggle-toc"');
  });

  test("a streamed doc with one section keeps comments only", () => {
    const html = render({ ...STREAM_DOC, hasToc: false, open: 0 });
    expect(html).toContain('data-testid="toggle-comments"');
    expect(html).not.toContain('data-testid="toggle-toc"');
  });

  test("a /s/<non-id> path has no doc toggles", () => {
    const html = render({ ...DOC, id: "118d065fcf" }, { path: "/s/not-a-session" });
    expect(html).not.toContain('data-testid="toggle-comments"');
    expect(html).not.toContain('data-testid="toggle-toc"');
  });

  test("the inbox merges its controls into the one bar; other pages keep the tab strip", () => {
    const inbox = render(null, { path: "/inbox" });
    expect(inbox).toContain('data-testid="rw-header"');
    expect(inbox).not.toContain('data-testid="tab-strip"');
    const settings = render(null, { path: "/inbox/settings" });
    expect(settings).toContain('data-testid="tab-strip"');
    const home = render(null, { path: "/" });
    expect(home).toContain('data-testid="tab-strip"');
  });
});
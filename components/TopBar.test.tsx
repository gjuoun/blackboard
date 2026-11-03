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

const DOC = { id: "str1", path: "/x.jsonl", readable: false, hasToc: false, open: 2, kind: "stream", streamHref: "/s/str1" } as const;

/** Render the bar with one open doc (or none on Home) and return its markup. */
function render(doc: Record<string, unknown> | null, over: { desktop?: boolean; path?: string } = {}) {
  pathname = over.path ?? (doc ? `/s/${doc.id}` : "/");
  desktop = over.desktop ?? true;
  chromeState = { tocOpen: true, cmOpen: true, sheet: null, doc };
  return renderToStaticMarkup(<TopBar />);
}

describe("TopBar doc toggles", () => {
  test("a stream opens its comments from the bar, on desktop and on a phone", () => {
    for (const width of [true, false]) {
      const html = render({ ...DOC }, { desktop: width });
      expect(html).toContain('data-testid="toggle-comments"');
      expect(html).not.toContain('data-testid="toggle-toc"');
      expect(html).toContain('data-testid="open-timeline"');
    }
  });

  test("the comments badge rides the toggle for a stream too", () => {
    const html = render({ ...DOC, open: 3 });
    expect(html).toContain('data-testid="toggle-comments"');
    expect(html).toMatch(/data-testid="toggle-comments"[\s\S]*<span[^>]*>3<\/span>/);
  });

  test("a doc page keeps both toggles and a code page keeps comments only", () => {
    const doc = render({ ...DOC, id: "doc1", readable: true, hasToc: true, open: 0, kind: "doc", streamHref: "/s/str1" });
    expect(doc).toContain('data-testid="toggle-comments"');
    expect(doc).toContain('data-testid="toggle-toc"');
    const code = render({ ...DOC, id: "code1", readable: true, hasToc: false, open: 0, kind: "code", streamHref: null });
    expect(code).toContain('data-testid="toggle-comments"');
    expect(code).not.toContain('data-testid="toggle-toc"');
  });

  test("Home has no doc toggles", () => {
    const html = render(null, { path: "/" });
    expect(html).not.toContain('data-testid="toggle-comments"');
    expect(html).not.toContain('data-testid="toggle-toc"');
  });
});
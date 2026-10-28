import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_PREFS, PANEL_LIMITS } from "@/lib/prefs";
import { PanelResizer } from "./PanelResizer";

const noop = () => {};

describe("PanelResizer", () => {
  test("the contents grip keeps its range and test id", () => {
    const html = renderToStaticMarkup(<PanelResizer which="toc" width={240} other={340} onDraft={noop} onCommit={noop} />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Resize contents panel"');
    expect(html).toContain('aria-valuemin="' + PANEL_LIMITS.toc.min + '"');
    expect(html).toContain('aria-valuemax="' + PANEL_LIMITS.toc.max + '"');
    expect(html).toContain('data-testid="resize-toc"');
  });

  test("the shared right rail keeps one grip and one persisted slot", () => {
    const html = renderToStaticMarkup(<PanelResizer which="cm" width={340} other={240} onDraft={noop} onCommit={noop} />);
    expect(html).toContain('aria-label="Resize comments and local PR panel"');
    expect(html).toContain('data-testid="resize-cm"');
    expect(html).toContain('aria-valuemin="' + PANEL_LIMITS.cm.min + '"');
    expect(html).toContain('aria-valuemax="' + PANEL_LIMITS.cm.max + '"');
    // The default reset width is the same cmW the persisted record uses.
    expect(DEFAULT_PREFS.cmW).toBe(340);
  });
});

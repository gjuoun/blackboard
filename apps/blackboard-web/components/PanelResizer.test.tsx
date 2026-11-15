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
    expect(html).toContain('aria-label="Resize comments panel"');
    expect(html).toContain('data-testid="resize-cm"');
    expect(html).toContain('aria-valuemin="' + PANEL_LIMITS.cm.min + '"');
    expect(html).toContain('aria-valuemax="' + PANEL_LIMITS.cm.max + '"');
    // The default reset width is the same cmW the persisted record uses.
    expect(DEFAULT_PREFS.cmW).toBe(340);
  });

  test("the inbox rail grip carries the rail range and sits on its inner edge", () => {
    const html = renderToStaticMarkup(<PanelResizer which="rail" breakpoint="lg" width={236} other={384} onDraft={noop} onCommit={noop} />);
    expect(html).toContain('aria-label="Resize inbox rail"');
    expect(html).toContain('data-testid="resize-rail"');
    expect(html).toContain('aria-valuemin="' + PANEL_LIMITS.rail.min + '"');
    expect(html).toContain('aria-valuemax="' + PANEL_LIMITS.rail.max + '"');
    // A left-edge panel: the grip lives on its right edge and only exists from lg.
    expect(html).toContain("right-0");
    expect(html).toContain("lg:block");
    expect(DEFAULT_PREFS.railW).toBe(236);
  });

  test("the preview grip is a right-edge panel, live from md", () => {
    const html = renderToStaticMarkup(<PanelResizer which="preview" width={384} other={236} onDraft={noop} onCommit={noop} />);
    expect(html).toContain('aria-label="Resize preview pane"');
    expect(html).toContain('data-testid="resize-preview"');
    expect(html).toContain('aria-valuemin="' + PANEL_LIMITS.preview.min + '"');
    expect(html).toContain('aria-valuemax="' + PANEL_LIMITS.preview.max + '"');
    expect(html).toContain("left-0");
    expect(html).toContain("md:block");
    expect(DEFAULT_PREFS.previewW).toBe(384);
  });
});

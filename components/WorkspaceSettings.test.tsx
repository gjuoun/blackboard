import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_PREFS } from "@/lib/prefs";

// The chrome store is module state shared across the suite (and TopBar.test mocks it outright), so
// this file mocks it too and feeds the component a fixed snapshot.
let chromeState = { ...DEFAULT_PREFS, tocOpen: true, cmOpen: true, showResolved: false, wrapCode: false, sheet: null, doc: null };
mock.module("./chrome", () => ({
  setChrome: () => {},
  togglePanel: () => {},
  resetReading: () => {},
  useChrome: () => chromeState,
  useIsDesktop: () => true,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceSettings } from "./WorkspaceSettings";

const render = () => renderToStaticMarkup(<WorkspaceSettings repos={["blackboard", "sites"]} version="0.3.0-beta.0" />);

describe("WorkspaceSettings", () => {
  test("renders the four groups in order", () => {
    const html = render();
    for (const group of ["sg-appearance", "sg-reading", "sg-workspace", "sg-about"]) expect(html).toContain(`data-testid="${group}"`);
    expect(html.indexOf("sg-appearance")).toBeLessThan(html.indexOf("sg-reading"));
    expect(html.indexOf("sg-reading")).toBeLessThan(html.indexOf("sg-workspace"));
    expect(html.indexOf("sg-workspace")).toBeLessThan(html.indexOf("sg-about"));
  });

  test("every row shows its current value on the right", () => {
    const html = render();
    // Appearance defaults: Warm · Light, Qu Black Sans, Default size.
    expect(html).toContain("Warm · Light");
    expect(html).toContain("Qu Black Sans");
    expect(html).toContain("Default");
    // Reading defaults: resume at last position, mark read on open, auto width.
    expect(html).toContain("Last position");
    expect(html).toContain("On");
    expect(html).toContain("Auto");
    // Workspace and about: storage path and the real version string.
    expect(html).toContain("~/.blackboard");
    expect(html).toContain("v0.3.0-beta.0");
    expect(html).toContain("Automatic");
  });

  test("the default repo row starts at All repos", () => {
    const html = render();
    expect(html).toContain('data-testid="sg-repo"');
    expect(html).toContain("All repos");
  });

  test("stored values ride the row instead of the defaults", () => {
    chromeState = { ...chromeState, theme: "warm-dark", docSize: "16", resumeOnOpen: false, textWidth: "wide", docRepo: "sites" };
    const html = render();
    expect(html).toContain("Warm · Dark");
    expect(html).toContain(">16<");
    expect(html).toContain("Top");
    expect(html).toContain("Full width");
    expect(html).toContain("sites");
    chromeState = { ...chromeState, theme: "warm-light", docSize: "default", resumeOnOpen: true, textWidth: "fit", docRepo: "" };
  });
});

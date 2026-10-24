import { expect, test } from "bun:test";
import {
  bootScript,
  clampPanel,
  clampPanels,
  DEFAULT_CHROME,
  DEFAULT_PREFS,
  PANEL_LIMITS,
  parsePrefs,
  serializePrefs,
  type StoredChrome,
} from "./prefs";

function fakeRoot() {
  const attrs = new Map<string, string>();
  const styles = new Map<string, string>();
  const classes = new Set<string>();
  const el = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) },
    style: { setProperty: (k: string, v: string) => void styles.set(k, v) },
  } as unknown as HTMLElement;
  return { el, attrs, styles, classes };
}

/** Run the pre-paint body exactly as the browser would: in the page, with storage and <html>. */
function runBoot(raw: string | null) {
  const root = fakeRoot();
  new Function("localStorage", "document", bootScript())({ getItem: () => raw }, { documentElement: root.el });
  return root;
}

test("parse: empty storage gives the defaults", () => {
  expect(parsePrefs(null)).toEqual(DEFAULT_CHROME);
});

test("parse: corrupt JSON gives the defaults", () => {
  expect(parsePrefs("{not json")).toEqual(DEFAULT_CHROME);
});

test("parse: legacy chrome payload keeps its booleans and gains the new defaults", () => {
  const got = parsePrefs(JSON.stringify({ tocOpen: false, cmOpen: false, showResolved: true, wrapCode: true }));
  expect(got).toMatchObject({ tocOpen: false, cmOpen: false, showResolved: true, wrapCode: true, ...DEFAULT_PREFS });
});

test("parse: unknown theme falls back to paper and keeps a known one", () => {
  expect(parsePrefs(JSON.stringify({ theme: "solarized" })).theme).toBe("paper");
  expect(parsePrefs(JSON.stringify({ theme: "night" })).theme).toBe("night");
});

test("parse: unknown font ids fall back per picker", () => {
  const got = parsePrefs(JSON.stringify({ fontLatin: "comic", fontCjk: "songti", fontMono: "nope" }));
  expect(got.fontLatin).toBe("qublack");
  expect(got.fontCjk).toBe("songti");
  expect(got.fontMono).toBe("qublack-mono");
});

test("parse: widths are clamped and strings are not numbers", () => {
  const got = parsePrefs(JSON.stringify({ tocW: 9999, cmW: "400" }));
  expect(got.tocW).toBe(PANEL_LIMITS.toc.max);
  expect(got.cmW).toBe(DEFAULT_PREFS.cmW);
});

test("serialize: only the known keys survive", () => {
  const raw = JSON.stringify({ ...DEFAULT_CHROME, theme: "night", stale: "x" });
  const out = JSON.parse(serializePrefs(parsePrefs(raw)));
  expect(out).not.toHaveProperty("stale");
  expect(out).toMatchObject({ theme: "night", tocOpen: true });
});

test("clamp: toc min and max", () => {
  expect(clampPanel(10, "toc")).toBe(PANEL_LIMITS.toc.min);
  expect(clampPanel(900, "toc")).toBe(PANEL_LIMITS.toc.max);
  expect(clampPanel(300, "toc")).toBe(300);
  expect(clampPanel(Number.NaN, "toc")).toBe(DEFAULT_PREFS.tocW);
});

test("clamp: comment min and max", () => {
  expect(clampPanel(1, "cm")).toBe(PANEL_LIMITS.cm.min);
  expect(clampPanel(9000, "cm")).toBe(PANEL_LIMITS.cm.max);
  expect(clampPanel(400, "cm")).toBe(400);
});

test("clamp: doc floor wins over the requested widths", () => {
  // 420 + 560 + 480 = 1460 > 1000: the comment panel gives back all 280 it can, then contents 180.
  expect(clampPanels({ tocW: 420, cmW: 560 }, 1000)).toEqual({ tocW: 240, cmW: PANEL_LIMITS.cm.min });
  // 1400 - 480 = 920 available: 240 + 340 = 580 fits, so nothing moves.
  expect(clampPanels({ tocW: 240, cmW: 340 }, 1400)).toEqual({ tocW: 240, cmW: 340 });
  // 1460 exactly is the smallest viewport that keeps everything.
  expect(clampPanels({ tocW: 420, cmW: 560 }, 1460)).toEqual({ tocW: 420, cmW: 560 });
});

test("clamp: a narrower viewport shrinks the comments panel first", () => {
  expect(clampPanels({ tocW: 420, cmW: 560 }, 1200)).toEqual({ tocW: 420, cmW: 300 });
});

test("boot: empty storage keeps defaults", () => {
  const root = runBoot(null);
  expect(root.attrs.get("data-theme")).toBeUndefined();
  expect(root.styles.get("--toc-w")).toBeUndefined();
});

test("boot: night sets data-theme and dark", () => {
  const root = runBoot(JSON.stringify({ theme: "night" }));
  expect(root.attrs.get("data-theme")).toBe("night");
  expect(root.classes.has("dark")).toBe(true);
});

test("boot: dark theme sets class only for dark palettes", () => {
  expect(runBoot(JSON.stringify({ theme: "paper" })).classes.has("dark")).toBe(false);
  expect(runBoot(JSON.stringify({ theme: "plain" })).classes.has("dark")).toBe(false);
});

test("boot: unknown theme keeps default", () => {
  const root = runBoot(JSON.stringify({ theme: "solarized" }));
  expect(root.attrs.get("data-theme")).toBeUndefined();
  expect(root.classes.has("dark")).toBe(false);
});

test("boot: font ids and widths are applied, bad ones ignored", () => {
  const root = runBoot(JSON.stringify({ fontLatin: "charter", fontCjk: "songti", fontMono: "mess", tocW: 9999, cmW: 300 }));
  expect(root.attrs.get("data-font-latin")).toBe("charter");
  expect(root.attrs.get("data-font-cjk")).toBe("songti");
  expect(root.attrs.get("data-font-mono")).toBeUndefined();
  expect(root.styles.get("--toc-w")).toBe(PANEL_LIMITS.toc.max + "px");
  expect(root.styles.get("--cm-w")).toBe("300px");
});

test("boot: a throwing storage never breaks the page", () => {
  const root = fakeRoot();
  const storage = { getItem() { throw new Error("blocked"); } };
  expect(() => new Function("localStorage", "document", bootScript())(storage, { documentElement: root.el })).not.toThrow();
  expect(root.attrs.size).toBe(0);
});

test("stored record type check: defaults satisfy the shape", () => {
  const s: StoredChrome = { ...DEFAULT_CHROME };
  expect(parsePrefs(serializePrefs(s))).toEqual(s);
});

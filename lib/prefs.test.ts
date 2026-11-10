import { expect, test } from "bun:test";
import {
  applyPrefs,
  bootScript,
  clampPanel,
  clampInbox,
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
    toggleAttribute: (k: string, on: boolean) => void (on ? attrs.set(k, "") : attrs.delete(k)),
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

test("parse: unknown theme falls back to warm and keeps a known one", () => {
  expect(parsePrefs(JSON.stringify({ theme: "solarized" })).theme).toBe("warm");
  expect(parsePrefs(JSON.stringify({ theme: "cold" })).theme).toBe("cold");
});

test("parse: an unknown or missing mode falls back to light", () => {
  expect(parsePrefs(JSON.stringify({ mode: "solarized" })).mode).toBe("light");
  expect(parsePrefs(JSON.stringify({})).mode).toBe("light");
  expect(parsePrefs(JSON.stringify({ theme: "cold", mode: "dark" })).mode).toBe("dark");
});

test("parse: retired and combined theme ids migrate to theme + mode", () => {
  const migrated = {
    paper: ["warm", "light"],
    plain: ["cold", "light"],
    night: ["warm", "dark"],
    "warm-light": ["warm", "light"],
    "warm-dark": ["warm", "dark"],
    "cold-light": ["cold", "light"],
    "cold-dark": ["cold", "dark"],
  } as const;
  for (const [oldId, [theme, mode]] of Object.entries(migrated)) {
    const got = parsePrefs(JSON.stringify({ theme: oldId }));
    expect({ oldId, theme: got.theme, mode: got.mode }).toEqual({ oldId, theme, mode });
  }
  // A combined id's own mode wins over a stored mode, so nothing half-migrates.
  const got = parsePrefs(JSON.stringify({ theme: "cold-dark", mode: "light" }));
  expect(got).toMatchObject({ theme: "cold", mode: "dark" });
  // The migration writes the new pair back, so the old id does not survive another round trip.
  const out = JSON.parse(serializePrefs(parsePrefs(JSON.stringify({ ...DEFAULT_CHROME, theme: "night" }))));
  expect(out).toMatchObject({ theme: "warm", mode: "dark" });
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

test("parse: the reading behaviour and workspace keys validate like the rest", () => {
  const got = parsePrefs(JSON.stringify({ docSize: "99", textWidth: "huge", resumeOnOpen: "yes", markReadOnOpen: false, docRepo: 42 }));
  expect(got).toMatchObject({ docSize: "default", textWidth: "fit", resumeOnOpen: true, markReadOnOpen: false, docRepo: "" });
  const kept = parsePrefs(JSON.stringify({ docSize: "15", textWidth: "wide", docRepo: "blackboard" }));
  expect(kept).toMatchObject({ docSize: "15", textWidth: "wide", docRepo: "blackboard" });
});

test("apply: the doc size and the wide flag paint on <html>", () => {
  const root = fakeRoot();
  applyPrefs(root.el, { ...DEFAULT_PREFS, docSize: "16", textWidth: "wide" });
  expect(root.styles.get("--doc-size")).toBe("16px");
  expect(root.attrs.has("data-doc-wide")).toBe(true);
  const back = fakeRoot();
  applyPrefs(back.el, { ...DEFAULT_PREFS, docSize: "default", textWidth: "fit" });
  expect(back.styles.get("--doc-size")).toBe("");
  expect(back.attrs.has("data-doc-wide")).toBe(false);
});

test("serialize: only the known keys survive", () => {
  const raw = JSON.stringify({ ...DEFAULT_CHROME, theme: "cold", mode: "dark", stale: "x" });
  const out = JSON.parse(serializePrefs(parsePrefs(raw)));
  expect(out).not.toHaveProperty("stale");
  expect(out).toMatchObject({ theme: "cold", mode: "dark", tocOpen: true });
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

test("parse: the inbox widths clamp to their own ranges", () => {
  const got = parsePrefs(JSON.stringify({ railW: 999, previewW: 9999 }));
  expect(got.railW).toBe(PANEL_LIMITS.rail.max);
  expect(got.previewW).toBe(PANEL_LIMITS.preview.max);
  // Garbage keeps the layout's defaults.
  const bad = parsePrefs(JSON.stringify({ railW: "wide", previewW: null }));
  expect(bad.railW).toBe(DEFAULT_PREFS.railW);
  expect(bad.previewW).toBe(DEFAULT_PREFS.previewW);
});

test("clamp: the inbox floor keeps the list, preview gives width back first", () => {
  // lg: 320 + 760 + 320 = 1400 > 1100, over 300 — the preview shrinks alone.
  expect(clampInbox({ railW: 320, previewW: 760 }, 1100)).toEqual({ railW: 320, previewW: 460 });
  // The overflow at any lg viewport can never out-eat the preview's room, so the rail keeps its
  // stored width even at the floor of lg.
  expect(clampInbox({ railW: 320, previewW: 760 }, 1024)).toEqual({ railW: 320, previewW: 384 });
  // Below lg the rail is not rendered, so it is not asked to shrink; the preview takes it all.
  expect(clampInbox({ railW: 320, previewW: 500 }, 900)).toEqual({ railW: 320, previewW: 500 });
  expect(clampInbox({ railW: 320, previewW: 700 }, 900)).toEqual({ railW: 320, previewW: 580 });
});

test("apply + boot: the inbox widths paint like the other panels", () => {
  const root = fakeRoot();
  applyPrefs(root.el, { ...DEFAULT_PREFS, railW: 300, previewW: 560 });
  expect(root.styles.get("--rail-w")).toBe("300px");
  expect(root.styles.get("--preview-w")).toBe("560px");
  const boot = runBoot(JSON.stringify({ railW: 10, previewW: 9999 }));
  expect(boot.styles.get("--rail-w")).toBe(PANEL_LIMITS.rail.min + "px");
  expect(boot.styles.get("--preview-w")).toBe(PANEL_LIMITS.preview.max + "px");
});

test("boot: empty storage keeps defaults", () => {
  const root = runBoot(null);
  expect(root.attrs.get("data-theme")).toBeUndefined();
  expect(root.styles.get("--toc-w")).toBeUndefined();
});

test("boot: a dark mode sets data-theme, data-mode and dark before paint", () => {
  const root = runBoot(JSON.stringify({ theme: "cold", mode: "dark" }));
  expect(root.attrs.get("data-theme")).toBe("cold");
  expect(root.attrs.get("data-mode")).toBe("dark");
  expect(root.classes.has("dark")).toBe(true);
});

test("boot: dark sets the class only in dark mode", () => {
  expect(runBoot(JSON.stringify({ theme: "warm" })).classes.has("dark")).toBe(false);
  expect(runBoot(JSON.stringify({ theme: "cold", mode: "light" })).classes.has("dark")).toBe(false);
  expect(runBoot(JSON.stringify({ theme: "warm", mode: "dark" })).classes.has("dark")).toBe(true);
});

test("boot: a retired or combined id paints its replacement on the first frame", () => {
  const root = runBoot(JSON.stringify({ theme: "night" }));
  expect(root.attrs.get("data-theme")).toBe("warm");
  expect(root.attrs.get("data-mode")).toBe("dark");
  expect(root.classes.has("dark")).toBe(true);
  const combined = runBoot(JSON.stringify({ theme: "cold-dark" }));
  expect(combined.attrs.get("data-theme")).toBe("cold");
  expect(combined.attrs.get("data-mode")).toBe("dark");
  expect(combined.classes.has("dark")).toBe(true);
  const paper = runBoot(JSON.stringify({ theme: "paper" }));
  expect(paper.attrs.get("data-theme")).toBe("warm");
  expect(paper.attrs.get("data-mode")).toBe("light");
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

test("boot: the doc size and the wide flag paint before the first frame", () => {
  const root = runBoot(JSON.stringify({ docSize: "15", textWidth: "wide" }));
  expect(root.styles.get("--doc-size")).toBe("15px");
  expect(root.attrs.has("data-doc-wide")).toBe(true);
  const quiet = runBoot(JSON.stringify({ docSize: "default" }));
  expect(quiet.styles.get("--doc-size")).toBeUndefined();
  expect(quiet.attrs.has("data-doc-wide")).toBe(false);
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

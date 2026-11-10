/**
 * The reading configuration that survives a reload: which palette, the three font picks and the two
 * side-panel widths. The vocabularies live here, not in the theme/font modules, so the parser can be
 * written and tested before either palette or font face exists; `lib/theme.ts` and `lib/fonts.ts`
 * key their registries off these ids.
 *
 * The whole record keeps riding on the existing `bb-chrome` key: the four booleans written by the
 * previous version are still read and written, so nobody loses a setting on upgrade.
 */
export const PREFS_KEY = "bb-chrome";

export const THEME_IDS = ["warm", "cold"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];
export const DEFAULT_MODE: Mode = "light";

/**
 * Theme ids this version no longer defines — the retired paper/plain/night palettes and the
 * combined theme-mode ids from before the data-mode split — and the pair that replaced each. A
 * stored record is read through this map and written back as theme + mode, so a browser keeps its
 * nearest counterpart instead of snapping to the default. Only the new ids appear in THEME_IDS.
 */
export const LEGACY_THEME: Record<string, { theme: ThemeId; mode: Mode }> = {
  paper: { theme: "warm", mode: "light" },
  plain: { theme: "cold", mode: "light" },
  night: { theme: "warm", mode: "dark" },
  "warm-light": { theme: "warm", mode: "light" },
  "warm-dark": { theme: "warm", mode: "dark" },
  "cold-light": { theme: "cold", mode: "light" },
  "cold-dark": { theme: "cold", mode: "dark" },
};

export const LATIN_IDS = ["qublack", "inter", "charter", "georgia", "system"] as const;
export type LatinId = (typeof LATIN_IDS)[number];
export const CJK_IDS = ["qublack", "pingfang", "songti", "wenkai"] as const;
export type CjkId = (typeof CJK_IDS)[number];
export const MONO_IDS = ["qublack-mono", "sarasa-mono", "jetbrains", "sf-mono"] as const;
export type MonoId = (typeof MONO_IDS)[number];

/** Document body sizes in px; "default" leaves the stylesheet's size alone. */
export const DOC_SIZE_IDS = ["default", "13", "14", "15", "16", "17"] as const;
export type DocSizeId = (typeof DOC_SIZE_IDS)[number];
export const DOC_SIZE_LABEL: Record<DocSizeId, string> = { default: "Default", "13": "13", "14": "14", "15": "15", "16": "16", "17": "17" };

/** The doc column: fit keeps the 760px cap, wide lets the body use the window. */
export const TEXT_WIDTH_IDS = ["fit", "wide"] as const;
export type TextWidthId = (typeof TEXT_WIDTH_IDS)[number];

/** The reading subset of the persisted record. */
type Prefs = {
  theme: ThemeId;
  /** Light or dark within the theme; drives `data-mode` and Tailwind's `.dark` class. */
  mode: Mode;
  fontLatin: LatinId;
  fontCjk: CjkId;
  fontMono: MonoId;
  tocW: number;
  cmW: number;
  /** The inbox's left rail and preview pane widths. */
  railW: number;
  previewW: number;
  docSize: DocSizeId;
  textWidth: TextWidthId;
  /** Reopen a document at the position it was left, from the stored progress. */
  resumeOnOpen: boolean;
  /** Tapping a row counts as reading the document (the workspace's default). */
  markReadOnOpen: boolean;
  /** The repo the workspace list opens filtered to; "" is every repo. */
  docRepo: string;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "warm",
  mode: "light",
  fontLatin: "qublack",
  fontCjk: "qublack",
  fontMono: "qublack-mono",
  tocW: 240,
  cmW: 340,
  railW: 236,
  previewW: 384,
  docSize: "default",
  textWidth: "fit",
  resumeOnOpen: true,
  markReadOnOpen: true,
  docRepo: "",
};

/** The rest of `bb-chrome`: what the top bar and the doc page already persist. */
type ChromeFlags = { tocOpen: boolean; cmOpen: boolean; showResolved: boolean; wrapCode: boolean };
export type StoredChrome = Prefs & ChromeFlags;
export const DEFAULT_CHROME: StoredChrome = { ...DEFAULT_PREFS, tocOpen: true, cmOpen: true, showResolved: false, wrapCode: false };


export const PANEL_LIMITS = {
  toc: { min: 180, max: 420 },
  cm: { min: 280, max: 560 },
  rail: { min: 180, max: 320 },
  preview: { min: 300, max: 760 },
} as const;
export type PanelKey = keyof typeof PANEL_LIMITS;
/** Which stored width each panel resizes. */
export const WIDTH_KEY: Record<PanelKey, "tocW" | "cmW" | "railW" | "previewW"> = { toc: "tocW", cm: "cmW", rail: "railW", preview: "previewW" };
/** Width the doc column must keep, so a drag can never squeeze the text to nothing. */
export const DOC_MIN = 480;
/** The inbox's middle column: the document list keeps 320px under a drag. */
export const LIST_MIN = 320;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inList = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

/** A stored theme id, migrated if it names a retired or combined id; anything unrecognised gets the default. */
const themeOf = (v: unknown): ThemeId => (inList(THEME_IDS, v) ? v : typeof v === "string" && LEGACY_THEME[v] ? LEGACY_THEME[v].theme : DEFAULT_PREFS.theme);
/** The stored mode. A combined legacy theme id carries its own mode; otherwise "dark"/"light" or the default. */
const modeOf = (o: Record<string, unknown>): Mode => {
  const m = inList(MODES, o.mode) ? o.mode : DEFAULT_MODE;
  if (typeof o.theme === "string" && LEGACY_THEME[o.theme]) return LEGACY_THEME[o.theme].mode;
  return m;
};

/** One panel width inside its own range. Garbage in (NaN, a string) gives the default back. */
export function clampPanel(px: unknown, which: PanelKey): number {
  if (!isNum(px)) return DEFAULT_PREFS[WIDTH_KEY[which]];
  const { min, max } = PANEL_LIMITS[which];
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * Both widths at once, honouring the doc floor: the comments panel gives width back first, then the
 * contents panel, each only down to its minimum. On a viewport too narrow for everything the minima
 * win and the doc keeps whatever is left — that is the honest outcome, not a negative column.
 */
export function clampPanels(p: { tocW: number; cmW: number }, viewport: number): { tocW: number; cmW: number } {
  let tocW = clampPanel(p.tocW, "toc");
  let cmW = clampPanel(p.cmW, "cm");
  if (!isNum(viewport) || viewport <= 0) return { tocW, cmW };
  const over = () => tocW + cmW + DOC_MIN - viewport;
  if (over() > 0) cmW = Math.max(PANEL_LIMITS.cm.min, cmW - over());
  if (over() > 0) tocW = Math.max(PANEL_LIMITS.toc.min, tocW - over());
  return { tocW, cmW };
}

/**
 * The inbox's two side panels against the window, honouring the list floor. Below lg the rail is
 * not rendered, so it keeps its stored width and only the preview is asked to shrink; above lg
 * the same rule, and the rail never needs to: its widest stored width plus the preview's room
 * (rail.max + LIST_MIN + preview.min = 960) already fits inside the lg floor.
 */
export function clampInbox(p: { railW: number; previewW: number }, viewport: number): { railW: number; previewW: number } {
  const railW = clampPanel(p.railW, "rail");
  let previewW = clampPanel(p.previewW, "preview");
  if (!isNum(viewport) || viewport <= 0) return { railW, previewW };
  const over = (viewport >= 1024 ? railW : 0) + previewW + LIST_MIN - viewport;
  if (over > 0) previewW = Math.max(PANEL_LIMITS.preview.min, previewW - over);
  return { railW, previewW };
}

/** The stored record from whatever `localStorage` held. Corrupt JSON, unknown ids and wild widths all fall back. */
export function parsePrefs(raw: string | null): StoredChrome {
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const bool = <K extends keyof StoredChrome>(k: K): StoredChrome[K] => (typeof o[k] === "boolean" ? (o[k] as StoredChrome[K]) : DEFAULT_CHROME[k]);
  return {
    theme: themeOf(o.theme),
    mode: modeOf(o),
    fontLatin: inList(LATIN_IDS, o.fontLatin) ? o.fontLatin : DEFAULT_PREFS.fontLatin,
    fontCjk: inList(CJK_IDS, o.fontCjk) ? o.fontCjk : DEFAULT_PREFS.fontCjk,
    fontMono: inList(MONO_IDS, o.fontMono) ? o.fontMono : DEFAULT_PREFS.fontMono,
    tocW: clampPanel(o.tocW, "toc"),
    cmW: clampPanel(o.cmW, "cm"),
    railW: clampPanel(o.railW, "rail"),
    previewW: clampPanel(o.previewW, "preview"),
    tocOpen: bool("tocOpen"),
    cmOpen: bool("cmOpen"),
    showResolved: bool("showResolved"),
    wrapCode: bool("wrapCode"),
    docSize: inList(DOC_SIZE_IDS, o.docSize) ? o.docSize : DEFAULT_PREFS.docSize,
    textWidth: inList(TEXT_WIDTH_IDS, o.textWidth) ? o.textWidth : DEFAULT_PREFS.textWidth,
    resumeOnOpen: bool("resumeOnOpen"),
    markReadOnOpen: bool("markReadOnOpen"),
    docRepo: typeof o.docRepo === "string" ? o.docRepo : DEFAULT_PREFS.docRepo,
  };
}

/** Only the keys this version knows, so a stale key cannot ride along forever. */
export function serializePrefs(s: StoredChrome): string {
  return JSON.stringify({
    theme: s.theme,
    mode: s.mode,
    fontLatin: s.fontLatin,
    fontCjk: s.fontCjk,
    fontMono: s.fontMono,
    tocW: s.tocW,
    cmW: s.cmW,
    railW: s.railW,
    previewW: s.previewW,
    tocOpen: s.tocOpen,
    cmOpen: s.cmOpen,
    showResolved: s.showResolved,
    wrapCode: s.wrapCode,
    docSize: s.docSize,
    textWidth: s.textWidth,
    resumeOnOpen: s.resumeOnOpen,
    markReadOnOpen: s.markReadOnOpen,
    docRepo: s.docRepo,
  });
}

/** Put a stored record on `<html>`: the palette, the dark class, the three font attributes and the widths. */
export function applyPrefs(el: HTMLElement, p: Prefs): void {
  el.setAttribute("data-theme", p.theme);
  el.setAttribute("data-mode", p.mode);
  el.classList.toggle("dark", p.mode === "dark");
  el.setAttribute("data-font-latin", p.fontLatin);
  el.setAttribute("data-font-cjk", p.fontCjk);
  el.setAttribute("data-font-mono", p.fontMono);
  el.toggleAttribute("data-doc-wide", p.textWidth === "wide");
  el.style.setProperty("--toc-w", clampPanel(p.tocW, "toc") + "px");
  el.style.setProperty("--cm-w", clampPanel(p.cmW, "cm") + "px");
  el.style.setProperty("--rail-w", clampPanel(p.railW, "rail") + "px");
  el.style.setProperty("--preview-w", clampPanel(p.previewW, "preview") + "px");
  el.style.setProperty("--doc-size", p.docSize === "default" ? "" : p.docSize + "px");
}

/**
 * The pre-paint body: the same rules as `applyPrefs`, generated from the same vocabularies, run from
 * an inline `<script>` in `<head>` before the app paints. Kept as a string so it ships without a
 * request; exercised in tests through `new Function("localStorage", "document", body)`.
 */
export function bootScript(): string {
  return (
    "(function(){try{" +
    'var s=JSON.parse(localStorage.getItem("' + PREFS_KEY + '")||"{}")||{};' +
    "var r=document.documentElement;" +
    "var themes=" + JSON.stringify(THEME_IDS) + ";" +
    "var modes=" + JSON.stringify(MODES) + ";" +
    "var old=" + JSON.stringify(LEGACY_THEME) + ";" +
    "var latin=" + JSON.stringify(LATIN_IDS) + ";" +
    "var cjk=" + JSON.stringify(CJK_IDS) + ";" +
    "var mono=" + JSON.stringify(MONO_IDS) + ";" +
    'var leg=typeof s.theme==="string"?old[s.theme]:null;' +
    'var th=leg?leg.theme:themes.indexOf(s.theme)>=0?s.theme:"";' +
    'var mo=leg?leg.mode:modes.indexOf(s.mode)>=0?s.mode:"light";' +
    'if(th){r.setAttribute("data-theme",th);r.setAttribute("data-mode",mo);r.classList.toggle("dark",mo==="dark");}' +
    'if(latin.indexOf(s.fontLatin)>=0)r.setAttribute("data-font-latin",s.fontLatin);' +
    'if(cjk.indexOf(s.fontCjk)>=0)r.setAttribute("data-font-cjk",s.fontCjk);' +
    'if(mono.indexOf(s.fontMono)>=0)r.setAttribute("data-font-mono",s.fontMono);' +
    "var t=[" + PANEL_LIMITS.toc.min + "," + PANEL_LIMITS.toc.max + "," + PANEL_LIMITS.cm.min + "," + PANEL_LIMITS.cm.max + "];" +
    'if(typeof s.tocW==="number"&&isFinite(s.tocW))r.style.setProperty("--toc-w",Math.min(t[1],Math.max(t[0],Math.round(s.tocW)))+"px");' +
    'if(typeof s.cmW==="number"&&isFinite(s.cmW))r.style.setProperty("--cm-w",Math.min(t[3],Math.max(t[2],Math.round(s.cmW)))+"px");' +
    "var w=[" + PANEL_LIMITS.rail.min + "," + PANEL_LIMITS.rail.max + "," + PANEL_LIMITS.preview.min + "," + PANEL_LIMITS.preview.max + "];" +
    'if(typeof s.railW==="number"&&isFinite(s.railW))r.style.setProperty("--rail-w",Math.min(w[1],Math.max(w[0],Math.round(s.railW)))+"px");' +
    'if(typeof s.previewW==="number"&&isFinite(s.previewW))r.style.setProperty("--preview-w",Math.min(w[3],Math.max(w[2],Math.round(s.previewW)))+"px");' +
    "var sizes=" + JSON.stringify(DOC_SIZE_IDS) + ";" +
    'if(sizes.indexOf(s.docSize)>0)r.style.setProperty("--doc-size",s.docSize+"px");' +
    'if(s.textWidth==="wide")r.setAttribute("data-doc-wide","");' +
    // The viewport height lets the server trim a streamed doc to what the first screen
    // can show; session cookie, refreshed on every page load, absent only until JS runs.
    'document.cookie="bbvh="+Math.round(window.innerHeight)+";path=/;SameSite=Lax";' +
    "}catch(e){}})();"
  );
}

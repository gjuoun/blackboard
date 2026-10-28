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

export const THEME_IDS = ["paper", "plain", "night"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
/** Each theme is one mode; the `.dark` class is derived from it so Tailwind's `dark:` still applies. */
export const THEME_MODE: Record<ThemeId, "light" | "dark"> = { paper: "light", plain: "light", night: "dark" };

export const LATIN_IDS = ["qublack", "inter", "charter", "georgia", "system"] as const;
export type LatinId = (typeof LATIN_IDS)[number];
export const CJK_IDS = ["qublack", "pingfang", "songti", "wenkai"] as const;
export type CjkId = (typeof CJK_IDS)[number];
export const MONO_IDS = ["qublack-mono", "sarasa-mono", "jetbrains", "sf-mono"] as const;
export type MonoId = (typeof MONO_IDS)[number];

/** The reading subset of the persisted record. */
export type Prefs = {
  theme: ThemeId;
  fontLatin: LatinId;
  fontCjk: CjkId;
  fontMono: MonoId;
  tocW: number;
  cmW: number;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "paper",
  fontLatin: "qublack",
  fontCjk: "qublack",
  fontMono: "qublack-mono",
  tocW: 240,
  cmW: 340,
};

/** The rest of `bb-chrome`: what the top bar and the doc page already persist. */
export type ChromeFlags = { tocOpen: boolean; cmOpen: boolean; showResolved: boolean; wrapCode: boolean };
export type StoredChrome = Prefs & ChromeFlags;
export const DEFAULT_CHROME: StoredChrome = { ...DEFAULT_PREFS, tocOpen: true, cmOpen: true, showResolved: false, wrapCode: false };

export const RIGHT_TABS = ["comments", "pr"] as const;
export type RightTab = (typeof RIGHT_TABS)[number];

/** The shared right column has two panes, selected by the URL (server-rendered), not a third panel. */
export function parseRightTab(v: unknown): RightTab {
  return inList(RIGHT_TABS, v) ? v : "comments";
}

export const PANEL_LIMITS = {
  toc: { min: 180, max: 420 },
  cm: { min: 280, max: 560 },
} as const;
export type PanelKey = keyof typeof PANEL_LIMITS;
/** Width the doc column must keep, so a drag can never squeeze the text to nothing. */
export const DOC_MIN = 480;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inList = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === "string" && (list as readonly string[]).includes(v);

/** One panel width inside its own range. Garbage in (NaN, a string) gives the default back. */
export function clampPanel(px: unknown, which: PanelKey): number {
  if (!isNum(px)) return DEFAULT_PREFS[which === "toc" ? "tocW" : "cmW"];
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

/** The stored record from whatever `localStorage` held. Corrupt JSON, unknown ids and wild widths all fall back. */
export function parsePrefs(raw: string | null): StoredChrome {
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const bool = (k: keyof ChromeFlags) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_CHROME[k]);
  return {
    theme: inList(THEME_IDS, o.theme) ? o.theme : DEFAULT_PREFS.theme,
    fontLatin: inList(LATIN_IDS, o.fontLatin) ? o.fontLatin : DEFAULT_PREFS.fontLatin,
    fontCjk: inList(CJK_IDS, o.fontCjk) ? o.fontCjk : DEFAULT_PREFS.fontCjk,
    fontMono: inList(MONO_IDS, o.fontMono) ? o.fontMono : DEFAULT_PREFS.fontMono,
    tocW: clampPanel(o.tocW, "toc"),
    cmW: clampPanel(o.cmW, "cm"),
    tocOpen: bool("tocOpen"),
    cmOpen: bool("cmOpen"),
    showResolved: bool("showResolved"),
    wrapCode: bool("wrapCode"),
  };
}

/** Only the keys this version knows, so a stale key cannot ride along forever. */
export function serializePrefs(s: StoredChrome): string {
  return JSON.stringify({
    theme: s.theme,
    fontLatin: s.fontLatin,
    fontCjk: s.fontCjk,
    fontMono: s.fontMono,
    tocW: s.tocW,
    cmW: s.cmW,
    tocOpen: s.tocOpen,
    cmOpen: s.cmOpen,
    showResolved: s.showResolved,
    wrapCode: s.wrapCode,
  });
}

/** Put a stored record on `<html>`: the palette, the dark class, the three font attributes and the widths. */
export function applyPrefs(el: HTMLElement, p: Prefs): void {
  el.setAttribute("data-theme", p.theme);
  el.classList.toggle("dark", THEME_MODE[p.theme] === "dark");
  el.setAttribute("data-font-latin", p.fontLatin);
  el.setAttribute("data-font-cjk", p.fontCjk);
  el.setAttribute("data-font-mono", p.fontMono);
  el.style.setProperty("--toc-w", clampPanel(p.tocW, "toc") + "px");
  el.style.setProperty("--cm-w", clampPanel(p.cmW, "cm") + "px");
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
    "var modes=" + JSON.stringify(THEME_MODE) + ";" +
    "var latin=" + JSON.stringify(LATIN_IDS) + ";" +
    "var cjk=" + JSON.stringify(CJK_IDS) + ";" +
    "var mono=" + JSON.stringify(MONO_IDS) + ";" +
    'if(typeof s.theme==="string"&&modes[s.theme]){r.setAttribute("data-theme",s.theme);r.classList.toggle("dark",modes[s.theme]==="dark");}' +
    'if(latin.indexOf(s.fontLatin)>=0)r.setAttribute("data-font-latin",s.fontLatin);' +
    'if(cjk.indexOf(s.fontCjk)>=0)r.setAttribute("data-font-cjk",s.fontCjk);' +
    'if(mono.indexOf(s.fontMono)>=0)r.setAttribute("data-font-mono",s.fontMono);' +
    "var t=[" + PANEL_LIMITS.toc.min + "," + PANEL_LIMITS.toc.max + "," + PANEL_LIMITS.cm.min + "," + PANEL_LIMITS.cm.max + "];" +
    'if(typeof s.tocW==="number"&&isFinite(s.tocW))r.style.setProperty("--toc-w",Math.min(t[1],Math.max(t[0],Math.round(s.tocW)))+"px");' +
    'if(typeof s.cmW==="number"&&isFinite(s.cmW))r.style.setProperty("--cm-w",Math.min(t[3],Math.max(t[2],Math.round(s.cmW)))+"px");' +
    "}catch(e){}})();"
  );
}

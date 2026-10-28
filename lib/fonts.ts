import { CJK_IDS, LATIN_IDS, MONO_IDS, type CjkId, type LatinId, type MonoId } from "./prefs";

/**
 * The pickers' vocabulary. Stacks live in `app/fonts.css` (one `[data-font-*="id"]` rule per entry)
 * so the boot script and the panel only ever write an attribute; `postscript` is what the
 * "installed?" hint probes with a local() FontFace, and an entry without one simply shows no hint.
 *
 * The PostScript names are the VARIABLE faces first, the older static names second (unchanged by the 1.3.0 rename to "Qu Black")
 * — Chromium only resolves local() by PostScript name, and the static names no longer exist on a
 * machine that has the family installed.
 */
export type FontEntry<Id extends string> = {
  id: Id;
  label: string;
  /** PostScript names a local() probe can resolve, most current first. */
  postscript?: string[];
  note?: string;
};

export type MonoEntry = FontEntry<MonoId> & {
  /** A Latin mono and a CJK mono that share the 2:1 grid, so mixed code stays in columns. */
  aligned: boolean;
};

export const LATIN_FONTS: FontEntry<LatinId>[] = [
  { id: "qublack", label: "Qu Black Sans", postscript: ["QuBlackSansVF-Regular", "QuBlackSans-Regular"], note: "ships with the app's Latin subset" },
  { id: "inter", label: "Inter", note: "installed or system fallback" },
  { id: "charter", label: "Charter", note: "serif, on macOS" },
  { id: "georgia", label: "Georgia", note: "serif, everywhere" },
  { id: "system", label: "System sans" },
];

export const CJK_FONTS: FontEntry<CjkId>[] = [
  { id: "qublack", label: "Qu Black Sans", postscript: ["QuBlackSansVF-Regular", "QuBlackSans-Regular"], note: "needs Qu Black installed" },
  { id: "pingfang", label: "苹方 PingFang SC", postscript: ["PingFangSC-Regular"], note: "macOS system" },
  { id: "songti", label: "宋体 Songti SC", note: "macOS system" },
  { id: "wenkai", label: "霞鹜文楷 LXGW WenKai", note: "install to use" },
];

export const MONO_FONTS: MonoEntry[] = [
  { id: "qublack-mono", label: "Qu Black Mono", postscript: ["QuBlackMonoVF-Regular", "QuBlackMono-Regular", "QuBlackMonoStatic-Regular"], aligned: true, note: "2:1 CJK, the default" },
  { id: "sarasa-mono", label: "Sarasa Mono SC", aligned: true, note: "2:1 CJK, install to use" },
  { id: "jetbrains", label: "JetBrains Mono", aligned: false, note: "Latin only — CJK columns drift" },
  { id: "sf-mono", label: "SF Mono", aligned: false, note: "Latin only — CJK columns drift" },
];

export const LATIN_BY_ID = (id: string) => LATIN_FONTS.find((f) => f.id === id) ?? LATIN_FONTS[0];
export const CJK_BY_ID = (id: string) => CJK_FONTS.find((f) => f.id === id) ?? CJK_FONTS[0];
export const MONO_BY_ID = (id: string) => MONO_FONTS.find((f) => f.id === id) ?? MONO_FONTS[0];

export { LATIN_IDS, CJK_IDS, MONO_IDS };

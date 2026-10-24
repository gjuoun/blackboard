import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CJK_BY_ID, CJK_FONTS, LATIN_BY_ID, LATIN_FONTS, MONO_BY_ID, MONO_FONTS } from "./fonts";
import { CJK_IDS, DEFAULT_PREFS, LATIN_IDS, MONO_IDS } from "./prefs";

const CSS = readFileSync(join(import.meta.dir, "..", "app", "fonts.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of `html[data-font-<slot>="<id>"] { … }`. */
function rule(slot: string, id: string): string | null {
  const m = new RegExp('html\\[data-font-' + slot + '="' + id + '"\\]\\s*\\{([^}]*)\\}').exec(CSS);
  return m ? m[1] : null;
}
const value = (body: string | null, key: string) => new RegExp("--" + key + "\\s*:\\s*([^;]+);").exec(body ?? "")?.[1].trim() ?? "";

test("fonts: the registries cover the prefs vocabularies exactly", () => {
  expect(LATIN_FONTS.map((f) => f.id).sort()).toEqual([...LATIN_IDS].sort());
  expect(CJK_FONTS.map((f) => f.id).sort()).toEqual([...CJK_IDS].sort());
  expect(MONO_FONTS.map((f) => f.id).sort()).toEqual([...MONO_IDS].sort());
  expect(LATIN_BY_ID("charter").id).toBe("charter");
  expect(CJK_BY_ID("nope").id).toBe(DEFAULT_PREFS.fontCjk);
  expect(MONO_BY_ID("nope").id).toBe(DEFAULT_PREFS.fontMono);
});

test("fonts: every registry id has its CSS rule and the defaults resolve", () => {
  for (const f of LATIN_FONTS) {
    const body = rule("latin", f.id);
    expect({ id: f.id, has: !!body }).toEqual({ id: f.id, has: true });
    expect({ id: f.id, stack: value(body, "font-latin").length > 0 }).toEqual({ id: f.id, stack: true });
  }
  for (const f of CJK_FONTS) {
    const body = rule("cjk", f.id);
    expect({ id: f.id, has: !!body }).toEqual({ id: f.id, has: true });
    expect({ id: f.id, stack: value(body, "font-cjk").length > 0 }).toEqual({ id: f.id, stack: true });
  }
  for (const f of MONO_FONTS) {
    const body = rule("mono", f.id);
    expect({ id: f.id, has: !!body }).toEqual({ id: f.id, has: true });
    expect({ id: f.id, latin: value(body, "font-mono-latin").length > 0 }).toEqual({ id: f.id, latin: true });
    expect({ id: f.id, cjk: value(body, "font-mono-cjk").length > 0 }).toEqual({ id: f.id, cjk: true });
  }
});

test("fonts: every CJK stack ends in a generic family", () => {
  for (const f of CJK_FONTS) {
    expect({ id: f.id, generic: /(sans-serif|serif|monospace)\s*$/.test(value(rule("cjk", f.id), "font-cjk")) }).toEqual({ id: f.id, generic: true });
  }
});

test("fonts: mono pairs declare alignment, and the aligned ones keep a 2:1 CJK side", () => {
  expect(MONO_FONTS.filter((f) => f.aligned).length).toBeGreaterThanOrEqual(2);
  for (const f of MONO_FONTS) {
    const body = rule("mono", f.id);
    const cjk = value(body, "font-mono-cjk");
    if (f.aligned) expect({ id: f.id, cjkMono: /(Mono|Sarasa)/.test(cjk) }).toEqual({ id: f.id, cjkMono: true });
    else expect({ id: f.id, warning: /Latin only/.test(f.note ?? "") }).toEqual({ id: f.id, warning: true });
  }
});

test("fonts: no duplicate PostScript names within a registry", () => {
  // QuBlack Sans is deliberately in both the Latin and the CJK picker (different families in CSS),
  // but one picker must never list the same physical face twice.
  for (const list of [LATIN_FONTS, CJK_FONTS, MONO_FONTS]) {
    const names = list.flatMap((f) => f.postscript ?? []);
    expect(new Set(names).size).toBe(names.length);
  }
});

test("fonts: the shipped faces and their licence are in public/fonts", () => {
  for (const name of ["qb-sans-latin", "qb-sans-bold-latin", "qb-mono-latin", "qb-mono-bold-latin"]) {
    const file = Bun.file(join(import.meta.dir, "..", "public", "fonts", name + ".woff2"));
    expect({ name, present: file.size > 0 }).toEqual({ name, present: true });
  }
  expect(Bun.file(join(import.meta.dir, "..", "public", "fonts", "OFL.txt")).size).toBeGreaterThan(0);
});

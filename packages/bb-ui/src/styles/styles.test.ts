import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPOSITE_ROLES, SHADCN_ROLES } from "../themes/roles";

/**
 * The shape gate for the two hand-written stylesheets. `styles.css` is the drop-in surface for a
 * stock shadcn theme, so it may only use shadcn's words; anything of ours lives in `composite.css`.
 */
const HERE = import.meta.dir;
const raw = (rel: string) => readFileSync(join(HERE, rel), "utf8");
const styles = raw("styles.css");
const composite = raw("composite.css");
const body = styles.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations inside a named at-rule block (`@theme inline { … }`) or a selector block. */
function blockOf(css: string, opener: string): string {
  const at = css.indexOf(opener);
  if (at < 0) throw new Error(`no ${opener}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${opener}`);
}

const keysIn = (css: string) => [...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]);

/** The prelude of every top-level statement: at-rules ending in `;` and blocks ending in `}`. */
function topLevel(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) out.push(css.slice(start, i).trim());
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (css[i] === ";" && depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out.filter(Boolean);
}

test("styles: the top-level statements are the six the pattern fixes, in order", () => {
  expect(topLevel(body)).toEqual([
    '@import "../themes/blackboard.css";',
    '@import "./composite.css";',
    '@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));',
    "@theme inline",
    ":root,\n[data-theme],\n[data-mode]",
    "@layer base",
  ]);
});

test("styles: @theme inline maps exactly the shadcn colours and the four radius steps", () => {
  const theme = keysIn(blockOf(body, "@theme inline"));
  const colours = theme.filter((k) => k.startsWith("color-")).map((k) => k.slice("color-".length));
  const radii = theme.filter((k) => k.startsWith("radius-"));
  expect(colours.sort()).toEqual([...SHADCN_ROLES].sort());
  expect(radii).toEqual(["radius-sm", "radius-md", "radius-lg", "radius-xl"]);
  // No font, shadow or size key: those belong to the app that consumes the theme.
  expect(
    theme.filter((k) => k.startsWith("font-") || k.startsWith("shadow-") || k.startsWith("text-")),
  ).toEqual([]);
});

test("styles: every semantic role is one var(--theme-*) hop, and the radius is the one constant", () => {
  const root = blockOf(body, ":root,\n[data-theme],\n[data-mode]");
  const decls = new Map([...root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  expect([...decls.keys()].sort()).toEqual(["radius", ...SHADCN_ROLES].sort());
  expect(decls.get("radius")).toBe("0.75rem");
  for (const role of SHADCN_ROLES)
    expect({ role, value: decls.get(role) }).toEqual({ role, value: `var(--theme-${role})` });
  // Not a colour and not ours: the scheme comes from the generated block, the fonts from the app.
  expect(body).not.toMatch(/color-scheme\s*:/);
  expect(body).not.toMatch(/light-dark\(/);
});

test("styles: composite.css carries only Blackboard's own roles", () => {
  const root = blockOf(composite, ":root,\n[data-theme],\n[data-mode]");
  const decls = new Map([...root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  expect([...decls.keys()].sort()).toEqual([...COMPOSITE_ROLES].sort());
  for (const role of COMPOSITE_ROLES)
    expect({ role, value: decls.get(role) }).toEqual({ role, value: `var(--theme-${role})` });
  // The shadcn words stay in styles.css.
  expect([...decls.keys()].filter((k) => (SHADCN_ROLES as readonly string[]).includes(k))).toEqual([]);
});

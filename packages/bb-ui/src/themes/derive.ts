/**
 * derive.ts — the slim palette. A block authors 14 colours and three mix ratios; this module turns
 * that into the 29 roles `roles.ts` declares, so `gen-tokens.ts` still writes one flat token list.
 *
 * Nothing here is a second palette: every value is a colour the block states, a copy of one, or one
 * of those colours mixed with the block's own `background`. A role is never an invented hue.
 */
import { REQUIRED, type Role } from "./roles";

/** The colours a palette block states outright. Everything else is a copy or a mix of these. */
export const AUTHORED_COLOURS = [
  "background",
  "foreground",
  "card",
  "primary",
  "secondary",
  "muted-foreground",
  "accent",
  "destructive",
  "border",
  "mark",
  "mark-line",
  "hl",
  "warn",
  "success",
] as const;
export type AuthoredColour = (typeof AUTHORED_COLOURS)[number];

/** The roles whose value is their own hue mixed over the block's `background`, as a percentage. */
export const RATIO_ROLES = ["primary-soft", "success-soft", "destructive-soft"] as const;
export type RatioRole = (typeof RATIO_ROLES)[number];
export type Ratios = Record<RatioRole, number>;

/** The four-percent steps a soft plate's mix may sit on, so a ratio is a step and not a hex. */
export const RATIO_GRID = [4, 8, 12, 16, 20] as const;

/** A palette block: the authored colours, the ratios, and nothing else that matters. */
export interface Block {
  [role: string]: string | Ratios | undefined;
  ratios?: Ratios;
}

/** Roles that are simply another role's colour: shadcn's two-layer vocabulary, spelled out. */
const ALIASES: Partial<Record<Role, Role>> = {
  "card-foreground": "foreground",
  "popover-foreground": "foreground",
  "secondary-foreground": "foreground",
  "accent-foreground": "foreground",
  popover: "card",
  muted: "secondary",
  input: "border",
  ring: "primary",
};

/** `code` is the page tinted one step: half the way from `background` to `secondary`. */
const CODE_SHARE = 0.5;

/** How much stronger the two highlight steps sit than the resting highlight. */
const HL_STEPS = { "hl-hover": 0.15, "hl-active": 0.2 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i;

/** The three sRGB channels of a `#rrggbb` or `rgb()/rgba()` colour. */
export function channelsOf(value: string): [number, number, number] {
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(value);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  const hex = value.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** `over` painted at `share` on top of `under`, rounded back to a hex. */
export function mix(over: string, under: string, share: number): string {
  const [a, b] = [channelsOf(over), channelsOf(under)];
  const rgb = a.map((c, i) => Math.round(c * share + b[i] * (1 - share)));
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** WCAG 2.1 relative luminance. */
function luminance(value: string): number {
  const [r, g, b] = channelsOf(value)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The same colour at a higher alpha: what a highlight does on hover and while held. */
function strengthen(value: string, delta: number): string {
  const [r, g, b] = channelsOf(value);
  const stated = /rgba\([^)]*?,\s*([\d.]+)\s*\)/.exec(value);
  const alpha = Math.min(1, Number(((stated ? Number(stated[1]) : 1) + delta).toFixed(2)));
  return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
}

/**
 * What a block must look like, as a list of problems (empty when it is well formed): exactly the
 * authored colours, exactly the three ratios, every ratio on the grid, every colour a colour. The
 * generator runs this before writing, so a malformed palette fails `theme:sync` by name instead of
 * painting something nobody chose.
 */
export function validateBlock(id: string, block: Block): string[] {
  const problems: string[] = [];
  const keys = Object.keys(block).filter((key) => key !== "ratios");
  const missing = AUTHORED_COLOURS.filter((colour) => !keys.includes(colour));
  const extra = keys.filter((key) => !(AUTHORED_COLOURS as readonly string[]).includes(key));
  if (missing.length) problems.push(id + " is missing " + missing.join(", "));
  if (extra.length) problems.push(id + " states roles that must be derived: " + extra.join(", "));

  for (const role of AUTHORED_COLOURS) {
    const value = block[role];
    if (typeof value !== "string") continue; // reported above as missing
    // Every colour is a plain hex; the highlight is the one role that also carries an alpha.
    const ok = role === "hl" ? HEX.test(value) || RGBA.test(value) : HEX.test(value);
    if (!ok) problems.push(id + " " + role + " is not a colour: " + value);
  }

  const ratios = block.ratios;
  if (!ratios) return [...problems, id + " has no ratios"];
  const stated = Object.keys(ratios);
  const noRatio = RATIO_ROLES.filter((role) => !stated.includes(role));
  const extraRatio = stated.filter((role) => !(RATIO_ROLES as readonly string[]).includes(role));
  if (noRatio.length) problems.push(id + " is missing ratios for " + noRatio.join(", "));
  if (extraRatio.length) problems.push(id + " has ratios for roles that are not mixes: " + extraRatio.join(", "));
  for (const role of RATIO_ROLES) {
    const ratio = ratios[role];
    if (!(RATIO_GRID as readonly number[]).includes(ratio)) {
      problems.push(id + " " + role + " ratio " + ratio + " is not on the grid " + RATIO_GRID.join("/"));
    }
  }
  return problems;
}

/**
 * One block, 29 roles. `primary-foreground` is the ink that sits on `primary`: the card surface or
 * the page, whichever reads against the button — the same rule in both modes, so a block cannot
 * quietly pick the wrong one.
 */
export function expand(block: Block): Record<Role, string> {
  const colour = (role: string): string => {
    const value = block[role];
    if (typeof value !== "string") throw new Error("palette block is missing " + role);
    return value;
  };
  const ratios = block.ratios;
  if (!ratios) throw new Error("palette block is missing ratios");

  const out = {} as Record<Role, string>;
  for (const role of AUTHORED_COLOURS) out[role] = colour(role);
  for (const [role, source] of Object.entries(ALIASES)) out[role as Role] = out[source];

  out["primary-foreground"] =
    contrast(out.card, out.primary) >= contrast(out.background, out.primary) ? out.card : out.background;
  out.code = mix(out.secondary, out.background, CODE_SHARE);

  for (const soft of RATIO_ROLES) {
    const hue = soft.replace("-soft", "") as Role;
    out[soft] = mix(out[hue], out.background, ratios[soft] / 100);
  }
  for (const [role, delta] of Object.entries(HL_STEPS)) out[role as Role] = strengthen(out.hl, delta);

  const unset = REQUIRED.filter((role) => !out[role]);
  if (unset.length) throw new Error("expand left roles unset: " + unset.join(", "));
  return out;
}
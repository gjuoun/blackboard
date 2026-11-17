import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTHORED_COLOURS,
  type Block,
  channelsOf,
  expand,
  RATIO_GRID,
  RATIO_ROLES,
  type RatioRole,
  validateBlock,
} from "./derive";
import { REQUIRED, type Role } from "./roles";

/**
 * The derivation guard. The palette states 14 colours and three ratios per block; this file proves
 * the expansion of those is the palette the app shipped, so a slim block cannot quietly repaint the
 * page. Copies must be exact; a mix may move a channel by at most BUDGET.
 */
const BUDGET = 13;

const PALETTE = join(import.meta.dir, "..", "..", "..", "bb-tokens", "palette", "palette.json");
const palette = JSON.parse(readFileSync(PALETTE, "utf8")) as Record<string, Record<string, Block>>;

const THEMES = ["warm", "cold"] as const;
const MODES = ["light", "dark"] as const;
const blocks = THEMES.flatMap((theme) => MODES.map((mode) => ({ id: `${theme}/${mode}`, theme, mode })));

/** What each block hand-wrote for the four derived colours before the palette was slimmed. */
const SHIPPED: Record<string, Record<"code" | RatioRole, string>> = {
  "warm/light": {
    code: "#f6f2ed",
    "primary-soft": "#f8e6df",
    "success-soft": "#ebf7ef",
    "destructive-soft": "#fdecee",
  },
  "warm/dark": {
    code: "#241f1b",
    "primary-soft": "#3a241c",
    "success-soft": "#14261a",
    "destructive-soft": "#2a1416",
  },
  "cold/light": {
    code: "#f6f8fa",
    "primary-soft": "#e7f0fb",
    "success-soft": "#eaf6ec",
    "destructive-soft": "#fdecec",
  },
  "cold/dark": {
    code: "#141a21",
    "primary-soft": "#16324d",
    "success-soft": "#12261a",
    "destructive-soft": "#2a1416",
  },
};

/** The largest per-channel distance between two colours; alpha is compared apart. */
const drift = (a: string, b: string) =>
  Math.max(...channelsOf(a).map((c, i) => Math.abs(c - channelsOf(b)[i])));

test("derive: a block states the 14 authored colours and three ratios, nothing more", () => {
  expect(AUTHORED_COLOURS.length).toBe(14);
  expect(AUTHORED_COLOURS.filter((c) => !(REQUIRED as readonly string[]).includes(c))).toEqual([]);
  // A soft plate is a mix, never something a block states.
  expect(RATIO_ROLES.filter((r) => (AUTHORED_COLOURS as readonly string[]).includes(r))).toEqual([]);

  for (const { id, theme, mode } of blocks) {
    const block = palette[theme][mode];
    const keys = Object.keys(block)
      .filter((key) => key !== "ratios")
      .sort();
    expect({ id, keys }).toEqual({ id, keys: [...AUTHORED_COLOURS].sort() });
    expect({ id, ratios: Object.keys(block.ratios ?? {}).sort() }).toEqual({
      id,
      ratios: [...RATIO_ROLES].sort(),
    });
  }
});

test("derive: the ratio table sits on the 4% grid", () => {
  const table = Object.fromEntries(
    blocks.map(({ id, theme, mode }) => [
      id,
      RATIO_ROLES.map((soft) => palette[theme][mode].ratios![soft]).join("/"),
    ]),
  );
  console.log("ratios", JSON.stringify(table));
  expect(table).toEqual({
    "warm/light": "8/4/4",
    "warm/dark": "16/4/4",
    "cold/light": "12/8/8",
    "cold/dark": "20/8/8",
  });
  // The grid is uniform so a ratio is a step, not a hand-picked number.
  for (const { id, theme, mode } of blocks) {
    for (const soft of RATIO_ROLES) {
      const ratio = palette[theme][mode].ratios![soft];
      expect({ id, soft, grid: (RATIO_GRID as readonly number[]).includes(ratio) }).toEqual({
        id,
        soft,
        grid: true,
      });
    }
  }
});

test("derive: copies are exact and mixes stay inside the channel budget", () => {
  for (const { id, theme, mode } of blocks) {
    const out = expand(palette[theme][mode]);
    expect({ id, keys: Object.keys(out).sort() }).toEqual({ id, keys: [...REQUIRED].sort() });

    // A role that copies another role must equal it byte for byte.
    for (const [role, source] of [
      ["card-foreground", "foreground"],
      ["popover-foreground", "foreground"],
      ["secondary-foreground", "foreground"],
      ["accent-foreground", "foreground"],
      ["popover", "card"],
      ["muted", "secondary"],
      ["input", "border"],
      ["ring", "primary"],
    ] as const) {
      expect({ id, role, same: out[role] === out[source] }).toEqual({ id, role, same: true });
    }
    // The ink on primary is the block's own surface, not a fourth colour.
    expect({ id, ink: [out.card, out.background].includes(out["primary-foreground"]) }).toEqual({
      id,
      ink: true,
    });

    const softs = RATIO_ROLES.map((soft) => drift(SHIPPED[id][soft], out[soft]));
    const code = drift(SHIPPED[id].code, out.code);
    console.log(`${id} code Δ${code} soft Δ${softs.join("/")}`);
    expect({ id, code: code <= BUDGET }).toEqual({ id, code: true });
    for (const [i, soft] of RATIO_ROLES.entries())
      expect({ id, soft, ok: softs[i] <= BUDGET }).toEqual({ id, soft, ok: true });
  }
});

test("derive: a malformed block is rejected by name", () => {
  const good = palette["warm"]["light"];

  const extra = validateBlock("warm/light", { ...good, popover: "#ffffff" });
  expect(extra.join(" ")).toContain("states roles that must be derived: popover");

  const withoutPrimary = { ...good };
  delete withoutPrimary.primary;
  expect(validateBlock("warm/light", withoutPrimary).join(" ")).toContain("is missing primary");

  const offGrid = validateBlock("warm/light", { ...good, ratios: { ...good.ratios!, "success-soft": 10 } });
  expect(offGrid.join(" ")).toContain("success-soft ratio 10 is not on the grid");

  const notAColour = validateBlock("warm/light", { ...good, background: "rgb(250, 248, 245)" });
  expect(notAColour.join(" ")).toContain("background is not a colour");

  // A block that is well formed passes with nothing to say.
  expect(validateBlock("warm/light", good)).toEqual([]);
});

test("derive: a highlight keeps its hue and only steps its alpha", () => {
  for (const { id, theme, mode } of blocks) {
    const out = expand(palette[theme][mode]);
    const rgb = (v: string) => channelsOf(v).join(",");
    expect({ id, hover: rgb(out["hl-hover"]) === rgb(out.hl) }).toEqual({ id, hover: true });
    expect({ id, active: rgb(out["hl-active"]) === rgb(out.hl) }).toEqual({ id, active: true });
    // Stronger than the resting highlight, never weaker, and never past opaque.
    const alpha = (v: string) => Number(/rgba\([^)]*?,\s*([\d.]+)\s*\)/.exec(v)?.[1] ?? 1);
    expect({
      id,
      order: alpha(out.hl) < alpha(out["hl-hover"]) && alpha(out["hl-hover"]) < alpha(out["hl-active"]),
    }).toEqual({ id, order: true });
    expect({ id, capped: alpha(out["hl-active"]) <= 1 }).toEqual({ id, capped: true });
  }
});

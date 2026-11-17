import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCKS } from "./palette";
import { MODES, type Mode, REQUIRED, THEME_IDS, type ThemeId } from "./roles";

/** The palette as data must equal the palette as CSS — the catalogue reads one, the app paints the other. */
const css = readFileSync(join(import.meta.dir, "blackboard.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function cssBlock(theme: ThemeId, mode: Mode): Record<string, string> {
  const re = new RegExp('\\[data-theme="' + theme + '"\\]\\[data-mode="' + mode + '"]\\s*\\{([^}]*)\\}');
  const body = re.exec(css)?.[1];
  if (!body) throw new Error("no " + theme + "/" + mode + " block in blackboard.css");
  const out: Record<string, string> = {};
  for (const hit of body.matchAll(/--theme-([\w-]+)\s*:\s*([^;]+);/g)) out[hit[1]] = hit[2].trim();
  return out;
}

test("palette: every block carries all 29 roles", () => {
  for (const theme of THEME_IDS) {
    for (const mode of MODES) {
      expect({ block: theme + "/" + mode, keys: Object.keys(BLOCKS[theme][mode]).sort() }).toEqual({
        block: theme + "/" + mode,
        keys: [...REQUIRED].sort(),
      });
    }
  }
});

test("palette: the data equals the generated stylesheet", () => {
  let values = 0;
  let bad = 0;
  for (const theme of THEME_IDS) {
    for (const mode of MODES) {
      const shipped = cssBlock(theme, mode);
      for (const role of REQUIRED) {
        values++;
        if (BLOCKS[theme][mode][role] !== shipped[role]) {
          bad++;
          console.log(
            "mismatch " +
              theme +
              "/" +
              mode +
              " " +
              role +
              ": data " +
              BLOCKS[theme][mode][role] +
              " css " +
              shipped[role],
          );
        }
      }
    }
  }
  console.log("palette: 4 blocks, " + values + " values, " + bad + " mismatches");
  expect(bad).toBe(0);
});

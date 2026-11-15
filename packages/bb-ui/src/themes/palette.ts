/**
 * palette.ts — the four blocks expanded once, as data.
 *
 * `gen-tokens.ts` writes the same values as CSS for the components; this module is for whatever needs
 * the colours themselves: the app's `/ui` catalogue, a screenshot script, a test. `palette.test.ts`
 * pins the two together, so the data and the stylesheet cannot drift.
 */
import paletteJson from "@gjuoun/bb-tokens/palette.json";
import { contrast, expand, type Block } from "./derive";
import { MODES, THEME_IDS, type Mode, type Role, type ThemeId } from "./roles";

export { contrast };

export type BlockValues = Record<Role, string>;
export type Blocks = Record<ThemeId, Record<Mode, BlockValues>>;

const source = paletteJson as unknown as Record<string, Record<string, Block>>;

/** `BLOCKS.warm.dark.primary` is the colour the components paint in warm dark. */
export const BLOCKS: Blocks = Object.fromEntries(
  THEME_IDS.map((theme) => [
    theme,
    Object.fromEntries(MODES.map((mode) => [mode, expand(source[theme][mode])])),
  ]),
) as Blocks;
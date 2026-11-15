import { BLOCKS, contrast } from "@gjuoun/bb-ui/themes/palette";
import { THEMES, type Mode, type ThemeId } from "@gjuoun/bb-ui/themes";

/**
 * Blackboard's own tokens, and only those. The nine shadcn names that merely copy one of these
 * (card-foreground, popover, popover-foreground, secondary-foreground, accent-foreground, muted,
 * input, ring, primary-foreground) are not rows here: they are aliases the stylesheet derives.
 *
 * One block at a time — the theme and mode come from the selectors above, so the page never shows
 * four copies of the same table.
 */
const NATIVE = [
  { name: "background", kind: "authored", group: "Neutrals" },
  { name: "card", kind: "authored", group: "Neutrals" },
  { name: "secondary", kind: "authored", group: "Neutrals" },
  { name: "accent", kind: "authored", group: "Neutrals" },
  { name: "border", kind: "authored", group: "Neutrals" },
  { name: "foreground", kind: "authored", group: "Ink" },
  { name: "muted-foreground", kind: "authored", group: "Ink" },
  { name: "primary", kind: "authored", group: "Accents" },
  { name: "destructive", kind: "authored", group: "Accents" },
  { name: "warn", kind: "authored", group: "Accents" },
  { name: "success", kind: "authored", group: "Accents" },
  { name: "mark", kind: "authored", group: "Accents" },
  { name: "mark-line", kind: "authored", group: "Accents" },
  { name: "hl", kind: "authored", group: "Accents" },
  { name: "primary-soft", kind: "derived", group: "Plates and steps" },
  { name: "code", kind: "derived", group: "Plates and steps" },
  { name: "success-soft", kind: "derived", group: "Plates and steps" },
  { name: "destructive-soft", kind: "derived", group: "Plates and steps" },
  { name: "hl-hover", kind: "derived", group: "Plates and steps" },
  { name: "hl-active", kind: "derived", group: "Plates and steps" },
] as const;

type Token = (typeof NATIVE)[number]["name"];
const GROUPS = ["Neutrals", "Ink", "Accents", "Plates and steps"] as const;

/** The text pairs that carry meaning: body, muted, link, button ink, the diff plates, inline code. */
const PAIRS = [
  { label: "Body text on the page", text: "foreground", on: "background", min: 7 },
  { label: "Muted text on the page", text: "muted-foreground", on: "background", min: 4.5 },
  { label: "Link and focus ring on the page", text: "primary", on: "background", min: 4.5 },
  { label: "Primary button: ink on fill", text: "primary-foreground", on: "primary", min: 4.5 },
  { label: "Added line on its plate", text: "success", on: "success-soft", min: 4.5 },
  { label: "Deleted line on its plate", text: "destructive", on: "destructive-soft", min: 4.5 },
  { label: "Inline code on its plate", text: "foreground", on: "code", min: 4.5 },
] as const;

const RULES = [
  "Five neutrals, two inks and seven accents are written by hand. The surfaces that copy one of them (popover, muted, input, ring) are aliases, not extra colours.",
  "The three plates are their hue mixed into the page at a fixed step — primary-soft 8 / 16 / 12 / 20%, success-soft and destructive-soft 4 / 4 / 8 / 8% — warm light, warm dark, cold light, cold dark.",
  "code is secondary half-way to background. hl-hover and hl-active are hl's own RGB at a higher alpha, so a highlight deepens without changing hue.",
  "primary-foreground is whichever of card and background reads better on primary: the same rule in both modes.",
];

function Swatch({ role, hex }: { role: Token; hex: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        data-swatch
        data-role={role}
        data-hex={hex}
        style={{ backgroundColor: "var(--theme-" + role + ")" }}
        className="inline-block size-5 shrink-0 rounded-sm border border-foreground/30"
      />
      <span className="font-mono text-[11px]">{hex}</span>
    </span>
  );
}

function GroupRows({ group, values }: { group: string; values: Record<string, string> }) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={2}
          className="px-2 pt-3 pb-1 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          {group}
        </th>
      </tr>
      {NATIVE.filter((token) => token.group === group).map((token) => (
        <tr key={token.name} className="border-t border-border">
          <th scope="row" className="px-2 py-[3px] text-left font-mono text-[11px] font-normal">
            {token.name}
            <span className="ml-2 text-[10px] text-muted-foreground">{token.kind}</span>
          </th>
          <td className="px-2 py-[3px]">
            <Swatch role={token.name} hex={values[token.name]} />
          </td>
        </tr>
      ))}
    </>
  );
}

export function PaletteSection({ theme, mode }: { theme: ThemeId; mode: Mode }) {
  const values = BLOCKS[theme][mode];
  const label = THEMES.find((t) => t.id === theme)?.label ?? theme;
  const authored = NATIVE.filter((token) => token.kind === "authored").length;

  return (
    <section
      id="colour"
      className="flex scroll-mt-6 flex-col gap-5 rounded-xl border border-border bg-card p-5 text-card-foreground"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Colour</h2>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          {label} · {mode}. Blackboard&rsquo;s own tokens: {NATIVE.length}, of which {authored} are
          written by hand and {NATIVE.length - authored} are derived from them. Every swatch is painted
          with its own token, so a swatch that disagrees with the hex beside it is a real drift.
        </p>
      </header>

      <div
        data-block={theme + "/" + mode}
        data-theme={theme}
        data-mode={mode}
        className="rounded-lg border border-border bg-background p-2 text-foreground"
      >
        <table className="w-full table-fixed text-sm">
          <tbody>
            {GROUPS.map((group) => (
              <GroupRows key={group} group={group} values={values} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-foreground">Body text</h3>
        <ul className="flex flex-col">
          {PAIRS.map((pair) => {
            const ratio = contrast(values[pair.text], values[pair.on]);
            const verdict = ratio >= pair.min ? "AA" : ratio >= 3 ? "large only" : "below AA";
            return (
              <li key={pair.label} className="flex items-center gap-3 border-t border-border py-1.5 text-sm first:border-0">
                <span
                  aria-hidden
                  className="inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-md px-2 text-sm leading-none font-medium"
                  style={{
                    backgroundColor: "var(--theme-" + pair.on + ")",
                    color: "var(--theme-" + pair.text + ")",
                  }}
                >
                  Aa
                </span>
                <span className="min-w-0">
                  {pair.label}
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {pair.text + " on " + pair.on}
                  </span>
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px]">
                  {ratio.toFixed(2) + ":1 "}
                  <span className={verdict === "AA" ? "text-muted-foreground" : "text-destructive"}>{verdict}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-foreground">Rules</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
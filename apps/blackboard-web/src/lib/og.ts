import { existsSync, readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

/**
 * The built-in font draws Latin text only; anything else would come out as empty boxes.
 */
export const drawable = (s: string) => /^[\x20-\x7E\u00A0-\u024F\u2010-\u2027]+$/.test(s);

/**
 * satori draws text, so it needs a font file. `next/og` shipped one; here the first face that exists
 * on this machine is used, because Blackboard runs locally. A missing face degrades to a card with
 * no words rather than a 500 — the palette and the mark are still correct.
 */
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Verdana.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

let cached: Buffer | null | undefined;
function font(): Buffer | null {
  if (cached !== undefined) return cached;
  const path = FONT_CANDIDATES.find((p) => existsSync(p));
  cached = path ? readFileSync(path) : null;
  return cached;
}

const INK = "#2b2622";
const MUTED = "#8a8178";
const PAPER = "#faf8f5";
const LINE = "#ebe5de";
const MARK = "#c4603f";

/** The share card: warm paper, the Blackboard mark, a big title and a line under it. */
export async function ogCard({ title, line }: { title: string; line: string }): Promise<ArrayBuffer> {
  const size = title.length > 60 ? 56 : title.length > 36 ? 72 : 92;
  const face = font();
  const tree = {
    type: "div",
    props: {
      style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: PAPER, color: INK },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", gap: 20 },
            children: [
              {
                type: "svg",
                props: {
                  width: 64,
                  height: 64,
                  viewBox: "0 0 64 64",
                  children: { type: "rect", props: { x: 13, y: 13, width: 38, height: 38, rx: 7, transform: "rotate(45 32 32)", fill: MARK } },
                },
              },
              { type: "div", props: { style: { fontSize: 36, fontWeight: 700 }, children: "Blackboard" } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: 24 },
            children: [
              { type: "div", props: { style: { fontSize: size, fontWeight: 800, lineHeight: 1.1, letterSpacing: -2, display: "flex" }, children: title } },
              { type: "div", props: { style: { fontSize: 34, color: MUTED, display: "flex" }, children: line } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", gap: 12 },
            children: ["Markdown", "Mermaid", "Comments", "Agent CLI"].map((t) => ({
              type: "div",
              props: { style: { display: "flex", padding: "8px 20px", borderRadius: 999, border: `2px solid ${LINE}`, background: "#fff", fontSize: 26, color: MUTED }, children: t },
            })),
          },
        },
      ],
    },
  };
  const svg = await satori(tree as never, {
    ...OG_SIZE,
    fonts: face ? [{ name: "card", data: face, weight: 400, style: "normal" }, { name: "card", data: face, weight: 700, style: "normal" }] : [],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_SIZE.width } }).render().asPng();
  // resvg hands back a Buffer; a Response body wants an ArrayBuffer, not a Buffer or a view over one.
  const bytes = new Uint8Array(png);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

/**
 * The share card: warm paper, the Blackboard mark, a big title and a line under it.
 * ImageResponse only ships a Latin font, so callers pass a title it can draw (see `drawable`).
 */
export function ogCard({ title, line }: { title: string; line: string }) {
  const size = title.length > 60 ? 56 : title.length > 36 ? 72 : 92;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#faf8f5", color: "#2b2622" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <rect x="13" y="13" width="38" height="38" rx="7" transform="rotate(45 32 32)" fill="#c4603f" />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 700 }}>Blackboard</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.1, letterSpacing: -2, display: "flex" }}>{title}</div>
          <div style={{ fontSize: 34, color: "#8a8178", display: "flex" }}>{line}</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {["Markdown", "Mermaid", "Comments", "Agent CLI"].map((t) => (
            <div key={t} style={{ display: "flex", padding: "8px 20px", borderRadius: 999, border: "2px solid #ebe5de", background: "#fff", fontSize: 26, color: "#8a8178" }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

/** The built-in font draws Latin text only; anything else would come out as empty boxes. */
export const drawable = (s: string) => /^[\x20-\x7E\u00A0-\u024F\u2010-\u2027]+$/.test(s);

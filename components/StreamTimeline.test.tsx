import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { blockTime } from "@/lib/block-time";
import { StreamTimeline } from "./StreamTimeline";

const ISO = "2026-11-02T17:14:55.097Z";
const BLOCK = { type: "block" as const, id: "a", n: 1, action: "answer" as const, author: "admin", at: ISO, body: "# One" };

describe("StreamTimeline", () => {
  test("an entry shows the local clock time and keeps the ISO in its title", () => {
    const html = renderToStaticMarkup(<StreamTimeline blocks={[BLOCK]} title="T" />);
    // the rail and the block header agree: same helper, same short form, same ISO kept
    expect(html).toContain(`title="${ISO}"`);
    expect(html).toContain(`>admin · ${blockTime(ISO).time}<`);
    expect(html).not.toContain(`admin · ${ISO}`);
  });
});

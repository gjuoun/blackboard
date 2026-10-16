import { describe, expect, test } from "bun:test";
import { anchor } from "./anchor";
import { renderPlainText } from "./markdown";
import { selectorFor } from "./selector";

const DOC = "# Design\n\nThe cache is warm. Later text. The cache is warm. End.\n";

describe("selectorFor", () => {
  test("second occurrence picks second repeat", async () => {
    const text = await renderPlainText(DOC);
    const r = selectorFor(text, "The cache is warm.", 2);
    if (!r.ok) throw new Error(r.error);
    expect(anchor(text, r.selector)?.start).toBe(text.lastIndexOf("The cache is warm."));
  });

  test("missing quote is an error", async () => {
    expect(selectorFor(await renderPlainText(DOC), "not there")).toEqual({ ok: false, error: 'quote not found in the doc: "not there"' });
  });

  test("an out-of-range occurrence says how many there are", async () => {
    const r = selectorFor(await renderPlainText(DOC), "The cache is warm.", 3);
    expect(r.ok ? "" : r.error).toBe("quote occurs 2 time(s); --occurrence must be 1..2");
  });

  test("a quote typed on one line matches text split by a line break", async () => {
    expect(selectorFor(await renderPlainText("alpha\nbeta"), "alpha beta").ok).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { anchor, makeSelector } from "./anchor";

const DOC = "The cache is warm. Later text. The cache is warm. End of overview.";
const second = DOC.lastIndexOf("The cache is warm.");
const selectSecond = () => makeSelector(DOC, second, second + "The cache is warm.".length);
const quoted = (text: string, r: { start: number; end: number } | null) => (r ? text.slice(r.start, r.end) : null);

describe("makeSelector", () => {
  test("keeps the passage and the text around it", () => {
    expect(selectSecond()).toEqual({
      exact: "The cache is warm.",
      prefix: "The cache is warm. Later text. ",
      suffix: " End of overview.",
    });
  });
});

describe("anchor", () => {
  test("picks second repeat by prefix", () => {
    expect(anchor(DOC, selectSecond())).toEqual({ start: second, end: second + 18 });
  });

  test("picks first repeat by suffix", () => {
    const sel = makeSelector(DOC, 0, 18);
    expect(anchor(DOC, sel)?.start).toBe(0);
  });

  test("survives insertion before", () => {
    const edited = "Intro added later.\n\n" + DOC;
    const r = anchor(edited, selectSecond());
    expect(r?.start).toBe(edited.lastIndexOf("The cache is warm."));
    expect(quoted(edited, r)).toBe("The cache is warm.");
  });

  test("still finds the passage when its context was rewritten", () => {
    const edited = "Something new. The cache is warm. Totally different ending.";
    expect(quoted(edited, anchor(edited, selectSecond()))).toBe("The cache is warm.");
  });

  test("tolerates the passage being re-wrapped onto two lines", () => {
    const sel = makeSelector("alpha beta gamma delta", 6, 16);
    const edited = "alpha beta\n  gamma delta";
    expect(quoted(edited, anchor(edited, sel))).toBe("beta\n  gamma");
  });

  test("returns null when removed", () => {
    const edited = DOC.replaceAll("The cache is warm.", "Gone.");
    expect(anchor(edited, selectSecond())).toBeNull();
  });

  test("returns null for an empty passage", () => {
    expect(anchor(DOC, { exact: "  ", prefix: "", suffix: "" })).toBeNull();
  });
});

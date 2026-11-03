import { describe, expect, test } from "bun:test";
import { blockTime } from "./block-time";

describe("block time", () => {
  test("an ISO stamp becomes the process's local HH:MM:SS, and the ISO is kept", () => {
    const iso = "2026-11-02T17:14:55.097Z";
    // the expectation is built from the same Date, so the test holds in any timezone
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const want = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    expect(blockTime(iso)).toEqual({ time: want, iso });
  });

  test("a stamp that is not a date is shown as it is", () => {
    expect(blockTime("t")).toEqual({ time: "t", iso: "t" });
  });
});

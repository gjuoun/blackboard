import { describe, expect, test } from "bun:test";
import { relativeTime, shortDateTime } from "./relative-time";

const now = Date.parse("2026-10-16T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  test("under a minute is just now (and the future too)", () => {
    expect(relativeTime(ago(30_000), now)).toBe("just now");
    expect(relativeTime(ago(-5 * MIN), now)).toBe("just now");
  });

  test("minutes, hours, days", () => {
    expect(relativeTime(ago(MIN), now)).toBe("1 min ago");
    expect(relativeTime(ago(59 * MIN), now)).toBe("59 min ago");
    expect(relativeTime(ago(HOUR), now)).toBe("1 hour ago");
    expect(relativeTime(ago(23 * HOUR), now)).toBe("23 hours ago");
    expect(relativeTime(ago(DAY), now)).toBe("1 day ago");
    expect(relativeTime(ago(6 * DAY), now)).toBe("6 days ago");
  });

  test("a week or more shows the date", () => {
    expect(relativeTime("2026-10-01T09:00:00Z", now)).toBe("Oct 1");
  });

  test("missing or bad input is unknown", () => {
    expect(relativeTime(null, now)).toBe("unknown");
    expect(relativeTime("nope", now)).toBe("unknown");
  });
});

describe("shortDateTime", () => {
  test("month, day and 24-hour time in the given zone", () => {
    expect(shortDateTime("2026-10-15T16:18:00Z", "UTC")).toBe("Oct 15, 16:18");
  });
});

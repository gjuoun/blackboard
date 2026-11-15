import { describe, expect, test } from "bun:test";
import { groupOf } from "./home-groups";

const now = new Date(2026, 9, 22, 15, 0).getTime();
const at = (daysAgo: number, hour = 12) => new Date(2026, 9, 22 - daysAgo, hour).toISOString();

describe("groupOf", () => {
  test("since local midnight is Today, even late yesterday is not", () => {
    expect(groupOf(at(0, 1), now)).toBe("Today");
    expect(groupOf(at(1, 23), now)).toBe("This week");
  });
  test("the six days before today are This week, older is Earlier", () => {
    expect(groupOf(at(6, 0), now)).toBe("This week");
    expect(groupOf(at(7, 12), now)).toBe("Earlier");
  });
  test("an unreadable date falls into Earlier", () => {
    expect(groupOf("nope", now)).toBe("Earlier");
  });
});

import { describe, expect, test } from "bun:test";
import { ulid } from "./ulid";

describe("ulid", () => {
  test("ulid: 26 crockford characters", () => {
    expect(ulid(0, new Uint8Array(10))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("ulid: sorts by time", () => {
    const a = ulid(1000, new Uint8Array(10).fill(255));
    const b = ulid(1001, new Uint8Array(10));
    expect(a < b).toBe(true);
  });

  test("ulid: distinct for the same millisecond with random bytes", () => {
    const x = ulid(5, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    const y = ulid(5, new Uint8Array([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
    expect(x).not.toBe(y);
  });
});

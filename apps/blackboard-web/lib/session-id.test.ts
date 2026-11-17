import { describe, expect, test } from "bun:test";
import { isSessionId, sessionIdOf } from "./session-id";

describe("isSessionId", () => {
  test("the sha1 form is accepted", () => {
    expect(isSessionId("118d065fcf")).toBe(true); // file session: sha1 hex slice(0, 10)
  });

  test("near misses and foreign strings are not ids", () => {
    for (const bad of [
      "118d065fc", // 9 hex chars
      "118d065fcf0", // 11
      "118D065FCF", // the sha1 form is lowercase
      "s-01M720SVVSKX0H7QGKNFRYC2JD", // the retired stream id form
      "scratchpad", // the retired fixed id
      "b-01M720SVVSKX0H7QGKNFRYC2JD", // a block id is not a session id
      "../x",
      "x/y",
      "a b",
      "",
    ])
      expect(isSessionId(bad)).toBe(false);
  });
});

describe("sessionIdOf", () => {
  test("reads the id on a session page, with or without a trailing slash", () => {
    expect(sessionIdOf("/s/118d065fcf")).toBe("118d065fcf");
    expect(sessionIdOf("/s/118d065fcf/")).toBe("118d065fcf");
  });

  test("other paths and ids no generator makes return null", () => {
    for (const p of [
      "/",
      "/inbox",
      "/s",
      "/s/",
      "/s/not-a-session",
      "/s/x/y",
      "/api/s/x",
      "/s/../..",
      "/s/118d065fcf/extra",
    ])
      expect(sessionIdOf(p)).toBeNull();
  });
});

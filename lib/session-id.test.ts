import { describe, expect, test } from "bun:test";
import { isSessionId, sessionIdOf } from "./session-id";

const STREAM = "s-01M720SVVSKX0H7QGKNFRYC2JD";

describe("isSessionId", () => {
  test("the three generator forms are accepted", () => {
    expect(isSessionId("118d065fcf")).toBe(true); // file session: sha1 hex slice(0, 10)
    expect(isSessionId(STREAM)).toBe(true); // stream: s- + 26-char Crockford ULID
    expect(isSessionId("scratchpad")).toBe(true); // the one fixed id
  });

  test("near misses and foreign strings are not ids", () => {
    for (const bad of [
      "118d065fc", // 9 hex chars
      "118d065fcf0", // 11
      "118D065FCF", // the sha1 form is lowercase
      "s-01M720SVVSKX0H7QGKNFRYC2J", // 25 ULID chars
      "s-01M720SVVSKX0H7QGKNFRYC2JDX", // 27
      "S-01M720SVVSKX0H7QGKNFRYC2JD", // the prefix is lowercase s
      "s-01M720SVVSKX0H7QGKNFRYC2JI", // I is not in Crockford base32
      "b-01M720SVVSKX0H7QGKNFRYC2JD", // a block id is not a session id
      "../x", "x/y", "a b", "",
    ]) expect(isSessionId(bad)).toBe(false);
  });
});

describe("sessionIdOf", () => {
  test("reads the id on a session page, with or without a trailing slash", () => {
    expect(sessionIdOf(`/s/${STREAM}`)).toBe(STREAM);
    expect(sessionIdOf("/s/118d065fcf")).toBe("118d065fcf");
    expect(sessionIdOf("/s/118d065fcf/")).toBe("118d065fcf");
    expect(sessionIdOf("/s/scratchpad")).toBe("scratchpad");
  });

  test("other paths and ids no generator makes return null", () => {
    for (const p of ["/", "/inbox", "/s", "/s/", "/s/not-a-session", "/s/x/y", "/api/s/x", "/s/../..", "/s/118d065fcf/extra"])
      expect(sessionIdOf(p)).toBeNull();
  });
});

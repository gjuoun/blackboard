import { describe, expect, test } from "bun:test";
import { docKey, type Session } from "./session-model";

const session = (over: Partial<Session> = {}): Session => ({
  id: "abc123def0",
  path: "/tmp/docs/design.md",
  createdAt: "2026-11-10T10:00:00.000Z",
  openedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});

describe("docKey", () => {
  test("a file session keys its comments by the file's basename", () => {
    expect(docKey(session())).toBe("design.md");
  });
});

describe("servablePath", () => {});

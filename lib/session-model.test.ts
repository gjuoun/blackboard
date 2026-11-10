import { describe, expect, test } from "bun:test";
import { docKey, servablePath, type Session } from "./session-model";

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

  test("a streamed doc keys its comments by the session id — it has no file", () => {
    expect(docKey(session({ id: "s-01K", kind: "stream", path: "" }))).toBe("s-01K");
  });
});

describe("servablePath", () => {
  test("a streamed doc has no file to serve", () => {
    expect(servablePath(session({ kind: "stream", path: "" }))).toBeNull();
  });
});

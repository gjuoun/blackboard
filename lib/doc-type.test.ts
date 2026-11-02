import { describe, expect, test } from "bun:test";
import { CODE_MAX_BYTES, docType, servableExtension } from "./doc-type";

describe("doc type", () => {
  test("classify: md is doc", () => {
    expect(docType("notes/design.md")).toEqual({ ok: true, type: "doc" });
    expect(docType("notes/design.md", "pr")).toEqual({ ok: true, type: "doc" });
  });

  test("classify: tsx is code", () => {
    expect(docType("app/page.tsx")).toEqual({ ok: true, type: "code" });
  });

  test("classify: jsonl needs stream kind", () => {
    const bare = docType("log/2026-11-01.jsonl");
    expect(bare.ok).toBe(false);
    expect(docType("log/2026-11-01.jsonl", "stream")).toEqual({ ok: true, type: "stream" });
    expect(docType("log/notes.md", "stream").ok).toBe(false);
  });

  test("classify: code kind refused for md", () => {
    expect(docType("a/b.ts", "pr").ok).toBe(false);
  });

  test("servable: txt and binaries never servable", () => {
    expect(servableExtension("a/secret.txt")).toBe(false);
    expect(servableExtension("a/x.png")).toBe(false);
    expect(servableExtension("a/x.md")).toBe(true);
    expect(servableExtension("a/x.tsx")).toBe(true);
  });

  test("code size cap is 1 MB", () => {
    expect(CODE_MAX_BYTES).toBe(1048576);
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "./lock";

const fresh = () => join(mkdtempSync(join(tmpdir(), "bb-lock-")), "comments.json");

describe("withFileLock", () => {
  test("removes the lock after the work, even when it throws", () => {
    const p = fresh();
    expect(() => withFileLock(p, () => { throw new Error("boom"); })).toThrow("boom");
    expect(existsSync(`${p}.lock`)).toBe(false);
    expect(withFileLock(p, () => 42)).toBe(42);
  });

  test("breaks a stale lock left by a dead process", () => {
    const p = fresh();
    writeFileSync(`${p}.lock`, "999999 2026-01-01T00:00:00Z");
    expect(withFileLock(p, () => "ran", 500)).toBe("ran");
  });

  test("breaks a lock older than the stale limit even if its pid is alive", () => {
    const p = fresh();
    writeFileSync(`${p}.lock`, `${process.pid} old`);
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${p}.lock`, old, old);
    expect(withFileLock(p, () => "ran", 500)).toBe("ran");
  });

  test("waits, then gives up on a live, fresh lock", () => {
    const p = fresh();
    writeFileSync(`${p}.lock`, `${process.pid} now`);
    const t0 = Date.now();
    expect(() => withFileLock(p, () => "never", 300)).toThrow(/timed out/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    expect(existsSync(`${p}.lock`)).toBe(true);
  });
});

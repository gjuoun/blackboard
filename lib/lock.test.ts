import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { run } from "../test/app";
import { Lock } from "./lock";

const fresh = () => join(mkdtempSync(join(tmpdir(), "bb-lock-")), "comments.json");

/** The lock as the app takes it: the service, the shared runtime, no spin on the event loop. */
const withFileLock = <A>(path: string, work: () => A, waitMs?: number): Promise<A> =>
  run(
    Effect.gen(function* () {
      const lock = yield* Lock;
      return yield* lock.withLock(path, Effect.sync(work), { waitMs });
    }),
  );

describe("Lock", () => {
  test("removes the lock after the work, even when it throws", async () => {
    const p = fresh();
    await expect(withFileLock(p, () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(`${p}.lock`)).toBe(false);
    expect(await withFileLock(p, () => 42)).toBe(42);
  });

  test("breaks a stale lock left by a dead process", async () => {
    const p = fresh();
    writeFileSync(`${p}.lock`, "999999 2026-01-01T00:00:00Z");
    expect(await withFileLock(p, () => "ran", 500)).toBe("ran");
  });

  test("breaks a lock older than the stale limit even if its pid is alive", async () => {
    const p = fresh();
    writeFileSync(`${p}.lock`, `${process.pid} old`);
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${p}.lock`, old, old);
    expect(await withFileLock(p, () => "ran", 500)).toBe("ran");
  });

  test("waits, then gives up on a live, fresh lock", async () => {
    const p = fresh();
    writeFileSync(`${p}.lock`, `${process.pid} now`);
    const t0 = Date.now();
    await expect(withFileLock(p, () => "never", 300)).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300);
    expect(existsSync(`${p}.lock`)).toBe(true);
  });
});
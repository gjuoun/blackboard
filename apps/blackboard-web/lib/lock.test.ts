import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { run } from "../test/app";
import { Lock } from "./lock";

const fresh = () => join(mkdtempSync(join(tmpdir(), "bb-lock-")), "comments.json");

/** The lock as the app takes it: one instance, a synchronous body, no spin on the event loop. */
const withFileLock = <A>(path: string, work: () => A, waitMs?: number): Promise<A> =>
  run(new Lock().withLock(path, () => Safe.call(work), { waitMs }));

describe("Lock", () => {
  test("removes the lock after the work, even when it throws", async () => {
    const p = fresh();
    await expect(
      withFileLock(p, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
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
    // The rejection is the observable. A wall-clock lower bound on top of it only adds a way to
    // fail on a loaded machine without proving anything the message does not already say.
    await expect(withFileLock(p, () => "never", 300)).rejects.toThrow(/timed out/);
    expect(existsSync(`${p}.lock`)).toBe(true);
  });
});

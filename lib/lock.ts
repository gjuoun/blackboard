import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";

export const LOCK_WAIT_MS = 5_000;
export const STALE_MS = 10_000;

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A lock is stale when its holder is gone or it is older than STALE_MS (a hung or crashed writer). */
function isStale(lockPath: string): boolean {
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs;
    const pid = Number(readFileSync(lockPath, "utf8").split(" ")[0]);
    return age > STALE_MS || (pid > 0 && !alive(pid));
  } catch {
    return false; // vanished between calls: just retry
  }
}

/**
 * Run `fn` while holding `<path>.lock`, shared by every process that writes the file (the web
 * app and the CLI). The lock is an exclusive create; waiters back off with jitter for up to
 * LOCK_WAIT_MS, and a stale lock is removed. Synchronous on purpose: the guarded work is a
 * read-change-write of one small JSON file.
 */
export function withFileLock<T>(path: string, fn: () => T, waitMs = LOCK_WAIT_MS): T {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + waitMs;
  let fd: number | null = null;
  for (let attempt = 0; fd === null; attempt++) {
    try {
      fd = openSync(lockPath, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (isStale(lockPath)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lockPath}`);
      sleepSync(Math.min(50, 2 ** attempt) + Math.random() * 10);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

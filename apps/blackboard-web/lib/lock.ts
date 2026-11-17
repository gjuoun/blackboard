import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { Pipe, Safe } from "@gjuoun/safe-ts";
import { LockTimeout } from "./errors";

const LOCK_WAIT_MS = 5_000;
const RETRY_MS = 10;
export const STALE_MS = 10_000;
export const STREAM_STALE_MS = 30_000;

/** How long a waiter tries, how old a lock may get before it is taken over, and the message it fails with. */
export type LockOptions = {
  readonly waitMs?: number;
  readonly staleMs?: number;
  /** Take over a lock whose recorded holder is gone, not just an old one. The stream lock only checks age. */
  readonly checkHolder?: boolean;
  readonly timeoutMessage?: (lockPath: string) => string;
};

/** One failed exclusive create, kept typed so the caller can tell "held" from "broken". */
type Busy = { readonly _tag: "Busy"; readonly code?: string };

/** Sleeping without an await: the stores hold the lock across synchronous file work only. */
const sleep = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const timeoutOf = (lockPath: string, options: LockOptions) =>
  new LockTimeout({
    message: options.timeoutMessage?.(lockPath) ?? `timed out waiting for ${lockPath}`,
    status: 400,
  });

/** Exclusive create plus the holder line; EEXIST comes back as a Busy, everything else as is. */
const create = (lockPath: string): Safe<number, Busy> =>
  Safe.call(
    () => {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
      return fd;
    },
    (error) => ({ _tag: "Busy" as const, code: (error as NodeJS.ErrnoException).code }),
  );

/** Age and holder of a lock file; null when it vanished between calls, which just means retry. */
const info = (lockPath: string): Safe<{ age: number; pid: number } | null> =>
  Safe.call(
    () => ({
      age: Date.now() - statSync(lockPath).mtimeMs,
      pid: Number(readFileSync(lockPath, "utf8").split(" ")[0]),
    }),
    () => null,
  );

/** True when the recorded holder is still running. EPERM means it exists under another user. */
const holderAlive = (pid: number): Safe<boolean> =>
  Safe.call(
    () => {
      process.kill(pid, 0);
      return true;
    },
    (error) => (error as NodeJS.ErrnoException).code === "EPERM",
  );

/** Stale means old, or held by a process that is gone when the caller asks about the holder. */
const isStale = (lockPath: string, options: LockOptions): Safe<boolean> =>
  Safe.try(function* () {
    const got = (yield info(lockPath)) as { age: number; pid: number } | null;
    if (!got) return false;
    if (got.age > (options.staleMs ?? STALE_MS)) return true;
    if (options.checkHolder === false) return false;
    return !((yield holderAlive(got.pid)) as boolean);
  });

/**
 * Take the lock: an exclusive create, retried on a short backoff until the waiter budget runs out.
 * A stale lock is removed and retried; a live one is waited for. The wait blocks this thread — the
 * body it guards is synchronous file work, so nothing else is due in the meantime.
 */
const acquire = (lockPath: string, options: LockOptions): Safe<number, LockTimeout> =>
  Safe.try(function* () {
    const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
    for (;;) {
      const made = (yield Safe.pipe(create(lockPath), Pipe.catchTag("Busy", (busy: Busy) => Safe.ok(busy)))) as
        | number
        | Busy;
      if (typeof made === "number") return made;
      if (made.code !== "EEXIST") return (yield Safe.err(timeoutOf(lockPath, options))) as never;
      if ((yield isStale(lockPath, options)) as boolean) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) return (yield Safe.err(timeoutOf(lockPath, options))) as never;
      sleep(RETRY_MS);
    }
  });

const release = (lockPath: string, fd: number): Safe<void> =>
  Safe.call(() => {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  });

/**
 * Run something while holding `<path>.lock`, shared by every process that writes the file (the web
 * app and the CLI). The lock is an exclusive create; a stale lock is removed and retried, and the
 * body runs with the lock released whatever the body's outcome.
 */
export class Lock {
  withLock<A, E>(path: string, body: () => Safe<A, E>, options: LockOptions = {}): Safe<A, E | LockTimeout> {
    const lockPath = `${path}.lock`;
    return Safe.try(function* () {
      const fd = (yield acquire(lockPath, options)) as number;
      return (yield Safe.pipe(
        body(),
        Pipe.ensuring(() => release(lockPath, fd)),
      )) as A;
    });
  }
}
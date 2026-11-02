import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { Context, Effect, Layer, Schedule } from "effect";
import { LockTimeout } from "./effect/errors";

const LOCK_WAIT_MS = 5_000;
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

/** One failed exclusive create, kept typed so the retry schedule can recognize it. */
type Busy = { readonly _tag: "Busy"; readonly lockPath: string };

/** True when the recorded holder is still running. EPERM means it exists under another user. */
const holderAlive = (pid: number): Effect.Effect<boolean> =>
  pid <= 0
    ? Effect.succeed(true)
    : Effect.try(() => {
        process.kill(pid, 0);
        return true;
      }).pipe(Effect.catch((error) => Effect.succeed((error as NodeJS.ErrnoException).code === "EPERM")));

/** Age and holder of a lock file; null when it vanished between calls, which just means retry. */
const lockInfo = (lockPath: string): Effect.Effect<{ age: number; pid: number } | null> =>
  Effect.try({
    try: () => {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      const pid = Number(readFileSync(lockPath, "utf8").split(" ")[0]);
      return { age, pid };
    },
    catch: () => "gone" as const,
  }).pipe(Effect.catch(() => Effect.succeed(null)));

/** Stale means old, or held by a process that is gone when the caller asks about the holder. */
const isStale = (lockPath: string, options: LockOptions): Effect.Effect<boolean> =>
  lockInfo(lockPath).pipe(
    Effect.flatMap((info) => {
      if (!info) return Effect.succeed(false);
      if (info.age > (options.staleMs ?? STALE_MS)) return Effect.succeed(true);
      return options.checkHolder === false ? Effect.succeed(false) : holderAlive(info.pid).pipe(Effect.map((alive) => !alive));
    }),
  );

/** Exclusive create plus the holder line; every other outcome is the error the caller classifies. */
const create = (lockPath: string): Effect.Effect<number, NodeJS.ErrnoException> =>
  Effect.try({
    try: () => {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
      return fd;
    },
    catch: (error) => error as NodeJS.ErrnoException,
  });

/** One attempt: the open fd, or Busy once the lock exists and is worth waiting for. */
const attempt = (lockPath: string, options: LockOptions): Effect.Effect<number, Busy> =>
  create(lockPath).pipe(
    Effect.catch((error): Effect.Effect<number, Busy> => {
      if (error.code !== "EEXIST") return Effect.die(error);
      return isStale(lockPath, options).pipe(
        Effect.flatMap((stale) =>
          stale
            ? Effect.sync(() => rmSync(lockPath, { force: true })).pipe(Effect.flatMap(() => attempt(lockPath, options)))
            : Effect.fail({ _tag: "Busy" as const, lockPath }),
        ),
      );
    }),
  );

const timeoutOf = (lockPath: string, options: LockOptions) =>
  new LockTimeout({ message: options.timeoutMessage?.(lockPath) ?? `timed out waiting for ${lockPath}`, status: 400 });

/** Busy is retried on a jittered exponential schedule until the waiter budget runs out. */
const acquire = (lockPath: string, options: LockOptions): Effect.Effect<number, LockTimeout> =>
  attempt(lockPath, options).pipe(
    Effect.retry({
      schedule: Schedule.spaced("10 millis").pipe(Schedule.jittered, Schedule.upTo({ duration: options.waitMs ?? LOCK_WAIT_MS })),
      while: (busy: Busy) => busy._tag === "Busy",
    }),
    Effect.catchTag("Busy", () => Effect.fail(timeoutOf(lockPath, options))),
  );

const release = (lockPath: string, fd: number): Effect.Effect<void> =>
  Effect.sync(() => {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  });

/**
 * Run an effect while holding `<path>.lock`, shared by every process that writes the file (the web
 * app and the CLI). The lock is an exclusive create; waiters back off on an Effect schedule, so a
 * waiting fiber yields instead of blocking the event loop, and a stale lock is removed.
 */
export class Lock extends Context.Service<
  Lock,
  {
    withLock<A, E, R>(path: string, effect: Effect.Effect<A, E, R>, options?: LockOptions): Effect.Effect<A, E | LockTimeout, R>;
  }
>()("blackboard/Lock") {}

export const layer = Layer.succeed(
  Lock,
  Lock.of({
    withLock: (path, effect, options = {}) => {
      const lockPath = `${path}.lock`;
      return Effect.acquireUseRelease(acquire(lockPath, options), () => effect, (fd) => release(lockPath, fd));
    },
  }),
);
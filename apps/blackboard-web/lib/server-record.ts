/**
 * The serve record: which process this home started, where it answers, and whether its pid is alive.
 * No probing here; that is server-status.ts. Nothing in this file imports another serve module.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Running the web app from the `blackboard` command: `serve start | stop | restart | status`, and
 * `open` starting it on first use. One process now: the Nitro build in `server/`, always Bun — the
 * API is mounted in-process on the same port (dev runs `bun api/server.ts` alongside instead).
 * What this module started is remembered in `<home>/server.json` as one `ui` proc entry; anything
 * else answering at the same address is treated as running but not ours to stop. Records from the
 * two-process era (`{ui,api}`) and the single-file era (bare proc) read back as their own shapes —
 * a running pair is still this home's to stop or restart.
 */
/** A serve failure the command reports as text: a bad port, a missing build, a server that did not start. */
export class ServerError extends Error {}

export const DEFAULT_URL = "http://127.0.0.1:38770";

export type Proc = { pid: number; url: string; startedAt: string };

/** The current record: one process serving UI and API on one port. */
export type ServerState = { ui: Proc };

/** A record from the two-process era: the UI plus the separate API it forwarded to. */
export type PairState = { ui: Proc; api: Proc };

/** A record the single-process CLI wrote before the app+api split: one proc at top level, no ui/api. */
export type LegacyState = { legacy: Proc };

export type RecordedState = ServerState | PairState | LegacyState;

export const statePath = (home: string) => join(home, "server.json");

export const uiLogPath = (home: string) => join(home, "server.log");

/** Where the app should answer: --port, else $BLACKBOARD_URL, else the default. Always an http origin. */
export function resolveUrl(
  opts: { port?: number | string; env?: Record<string, string | undefined> } = {},
): string {
  const env = opts.env ?? process.env;
  const base = new URL((env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, ""));
  if (opts.port !== undefined) {
    const n = Number(opts.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535)
      throw new ServerError(`--port must be a number from 1 to 65535, got "${opts.port}"`);
    base.protocol = "http:";
    base.hostname = "127.0.0.1";
    base.port = String(n);
  }
  return base.origin;
}

/** The port a URL names (80 / 443 when it names none). */
export function portOf(url: string): number {
  const u = new URL(url);
  return Number(u.port || (u.protocol === "https:" ? 443 : 80));
}

/**
 * Read the state file. The current shape is one `ui` proc; a two-proc `{ui,api}` file (the era when
 * the API was a second process) and a bare-proc file (before the split) read back as their own
 * marked records, never as none — their pids are ours to stop or restart, and reading them as
 * unrecorded was how `serve` once refused its own server.
 */
export function readState(home: string): RecordedState | null {
  try {
    const v = JSON.parse(readFileSync(statePath(home), "utf8"));
    const ok = (p: unknown): p is Proc =>
      !!p &&
      Number.isInteger((p as Proc).pid) &&
      typeof (p as Proc).url === "string" &&
      typeof (p as Proc).startedAt === "string";
    if (ok(v?.ui) && ok(v?.api)) return { ui: v.ui, api: v.api };
    if (ok(v?.ui)) return { ui: v.ui };
    return ok(v) ? { legacy: v } : null;
  } catch {
    return null;
  }
}

export function writeState(home: string, s: ServerState) {
  writeFileSync(statePath(home), JSON.stringify(s, null, 2) + "\n");
}

export const clearState = (home: string) => rmSync(statePath(home), { force: true });

/** The liveness probe, injectable so a test can pin the ESRCH/EPERM branches without a live process. */
export type KillProbe = (pid: number, signal: 0) => void;

export function pidAlive(pid: number, probe: KillProbe = (p, s) => void process.kill(p, s)): boolean {
  try {
    probe(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The serve record: which two processes this home started, where they answer, and whether a pid is alive.
 * No probing here; that is server-status.ts. Nothing in this file imports another serve module.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Running the web app + the API from the `blackboard` command: `serve start | stop | restart |
 * status`, and `open` starting them on first use. Two processes now: the standalone Next build in
 * `server/` (UI) and `dist/api.mjs` (API, always Bun — it owns bun:sqlite). What this module
 * started is remembered in `<home>/server.json` as two proc entries; anything else answering at
 * the same address is treated as running but not ours to stop.
 */
/** A serve failure the command reports as text: a bad port, a missing build, a pair that did not start. */
export class ServerError extends Error {}

export const DEFAULT_URL = "http://127.0.0.1:38770";

export const DEFAULT_API_URL = "http://127.0.0.1:38771";

export type Proc = { pid: number; url: string; startedAt: string };

export type ServerState = { ui: Proc; api: Proc };

export const statePath = (home: string) => join(home, "server.json");

export const uiLogPath = (home: string) => join(home, "server.log");

export const apiLogPath = (home: string) => join(home, "api.log");

/** Where the app should answer: --port, else $BLACKBOARD_URL, else the default. Always an http origin. */
export function resolveUrl(opts: { port?: number | string; env?: Record<string, string | undefined> } = {}): string {
  const env = opts.env ?? process.env;
  const base = new URL((env.BLACKBOARD_URL || DEFAULT_URL).replace(/\/+$/, ""));
  if (opts.port !== undefined) {
    const n = Number(opts.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ServerError(`--port must be a number from 1 to 65535, got "${opts.port}"`);
    base.protocol = "http:";
    base.hostname = "127.0.0.1";
    base.port = String(n);
  }
  return base.origin;
}

/** Where the API should answer: --api-port, else $BLACKBOARD_API_URL, else the default API port. */
export function resolveApiUrl(opts: { apiPort?: number | string; env?: Record<string, string | undefined> } = {}): string {
  const env = opts.env ?? process.env;
  const base = new URL((env.BLACKBOARD_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""));
  if (opts.apiPort !== undefined) {
    const n = Number(opts.apiPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ServerError(`--api-port must be a number from 1 to 65535, got "${opts.apiPort}"`);
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

/** Read the two-proc state file; a pre-B-round single-pid file reads as stale (null). */
export function readState(home: string): ServerState | null {
  try {
    const v = JSON.parse(readFileSync(statePath(home), "utf8"));
    const ok = (p: unknown): p is Proc => !!p && Number.isInteger((p as Proc).pid) && typeof (p as Proc).url === "string" && typeof (p as Proc).startedAt === "string";
    return ok(v?.ui) && ok(v?.api) ? v : null;
  } catch {
    return null;
  }
}

export function writeState(home: string, s: ServerState) {
  writeFileSync(statePath(home), JSON.stringify(s, null, 2) + "\n");
}

export const clearState = (home: string) => rmSync(statePath(home), { force: true });

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

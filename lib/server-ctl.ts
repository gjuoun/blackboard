import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Running the web app + the API from the `blackboard` command: `serve start | stop | restart |
 * status`, and `open` starting them on first use. Two processes now: the standalone Next build in
 * `server/` (UI) and `dist/api.mjs` (API, always Bun — it owns bun:sqlite). What this module
 * started is remembered in `<home>/server.json` as two proc entries; anything else answering at
 * the same address is treated as running but not ours to stop.
 */
export const DEFAULT_URL = "http://127.0.0.1:38770";
export const DEFAULT_API_URL = "http://127.0.0.1:38771";

type Proc = { pid: number; url: string; startedAt: string };
type ServerState = { ui: Proc; api: Proc };
type ServerStatus =
  | { running: false; url: string }
  | { running: true; url: string; managed: true; ui: Proc & { log: string }; api: Proc & { log: string } }
  | { running: true; url: string; managed: false };

export class ServerError extends Error {}

const statePath = (home: string) => join(home, "server.json");
const uiLogPath = (home: string) => join(home, "server.log");
const apiLogPath = (home: string) => join(home, "api.log");

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

/** True when a Blackboard answers at `url` (its /api/health says so). */
export async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    return (await res.json())?.app === "blackboard";
  } catch {
    return false;
  }
}

/** The package folder: where `.next` and `node_modules/next` live. Same for the built CLI and the source. */
function appRoot(from: string = import.meta.url): string {
  return dirname(dirname(fileURLToPath(from)));
}

/** Command that runs a JS file: Node when this process is Node or one is on PATH, else this Bun in Node-compat mode. */
export function runtimeFor(opts: { execPath: string; pathDirs: string[]; exists: (p: string) => boolean }): { cmd: string; args: string[] } {
  if (/^node(\.exe)?$/i.test(basename(opts.execPath))) return { cmd: opts.execPath, args: [] };
  for (const d of opts.pathDirs) {
    const p = join(d, process.platform === "win32" ? "node.exe" : "node");
    if (opts.exists(p)) return { cmd: p, args: [] };
  }
  return { cmd: opts.execPath, args: ["--bun"] };
}

const currentRuntime = () =>
  runtimeFor({ execPath: process.execPath, pathDirs: (process.env.PATH ?? "").split(delimiter).filter(Boolean), exists: existsSync });

/**
 * The folder to run the UI from. npm drops any folder named node_modules from a package, so the
 * build ships its dependencies as `modules`; the first start renames it back. When the package
 * folder is read-only (a root-owned global install) the app is copied under `<home>/runtime`.
 */
export function prepareServer(serverDir: string, home: string, version: string, rename: (from: string, to: string) => void = renameSync): string {
  const modules = join(serverDir, "modules");
  const nodeModules = join(serverDir, "node_modules");
  if (existsSync(nodeModules)) return serverDir;
  try {
    rename(modules, nodeModules);
    return serverDir;
  } catch {
    const copy = join(home, "runtime", version);
    if (!existsSync(join(copy, "node_modules"))) {
      rmSync(copy, { recursive: true, force: true });
      mkdirSync(dirname(copy), { recursive: true });
      cpSync(serverDir, copy, { recursive: true });
      renameSync(join(copy, "modules"), join(copy, "node_modules"));
    }
    return copy;
  }
}

const packageVersion = (root: string): string => {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
};

/** The command line that starts the production UI on `url`, and the folder to run it in. */
function uiStartCommand(root: string, home: string) {
  const serverDir = join(root, "server");
  if (!existsSync(join(serverDir, "server.js"))) {
    throw new ServerError("this copy has no production build; run `bun run build && bun run build:server` first (or use `bun dev`)");
  }
  const dir = prepareServer(serverDir, home, packageVersion(root));
  const rt = currentRuntime();
  return { cmd: rt.cmd, args: [...rt.args, join(dir, "server.js")], cwd: dir };
}

/**
 * The command line that starts the API, and the folder to run it in. Always Bun: storage is
 * bun:sqlite, so Node can never run this process. `dist/api.mjs` when the package shipped one,
 * else the source entry for a dev checkout.
 */
function apiStartCommand(root: string) {
  const bundled = join(root, "dist", "api.mjs");
  const source = join(root, "api", "server.ts");
  const entry = existsSync(bundled) ? bundled : existsSync(source) ? source : null;
  if (!entry) throw new ServerError("this copy has no API entry; run `bun run build:api` first");
  const exec = basename(process.execPath);
  if (!/^bun/i.test(exec)) {
    for (const d of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const p = join(d, process.platform === "win32" ? "bun.exe" : "bun");
      if (existsSync(p)) return { cmd: p, args: [entry], cwd: dirname(entry) };
    }
    throw new ServerError("the API needs Bun (it stores in bun:sqlite) and no `bun` is on PATH");
  }
  return { cmd: process.execPath, args: [entry], cwd: dirname(entry) };
}

function appEnv(home: string, url: string, apiUrl: string): NodeJS.ProcessEnv {
  return { ...process.env, NODE_ENV: "production", BLACKBOARD_HOME: home, BLACKBOARD_URL: url, BLACKBOARD_API_URL: apiUrl, PORT: String(portOf(url)), HOSTNAME: "127.0.0.1" };
}

function apiEnv(home: string, apiUrl: string): NodeJS.ProcessEnv {
  return { ...process.env, NODE_ENV: "production", BLACKBOARD_HOME: home, BLACKBOARD_API_URL: apiUrl, PORT: String(portOf(apiUrl)) };
}

export async function status(home: string, url = resolveUrl()): Promise<ServerStatus> {
  const st = readState(home);
  if (st) {
    const uiUp = pidAlive(st.ui.pid) && (await probe(st.ui.url));
    const apiUp = pidAlive(st.api.pid) && (await probe(st.api.url));
    if (uiUp && apiUp) {
      return { running: true, url: st.ui.url, managed: true, ui: { ...st.ui, log: uiLogPath(home) }, api: { ...st.api, log: apiLogPath(home) } };
    }
    // Half-dead is stale: the pair only counts when both answer.
    if (!uiUp || !apiUp) {
      clearState(home);
      return (await probe(url)) ? { running: true, url, managed: false } : { running: false, url };
    }
  }
  return (await probe(url)) ? { running: true, url, managed: false } : { running: false, url };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tail(file: string, lines = 8): string {
  try {
    return readFileSync(file, "utf8").trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

async function spawnAndWait(child: ChildProcess, url: string, log: string): Promise<void> {
  let exited: number | null | undefined;
  child.on("exit", (code) => (exited = code ?? -1));
  child.on("error", () => (exited = -1));
  child.unref();
  if (!child.pid) throw new ServerError(`could not start ${child.spawnfile}`);
  for (let i = 0; i < 100; i++) {
    if (exited !== undefined) break;
    if (await probe(url, 500)) return;
    await sleep(300);
  }
  if (exited === undefined) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  const why = exited !== undefined ? "the server exited" : "the server did not answer within 30 s";
  throw new ServerError(`${why} (${url}). Last log lines (${log}):\n${tail(log)}`);
}

/** Start the app + API in the background and wait until both answer. A running pair is left alone. */
export async function start(home: string, opts: { port?: number | string; apiPort?: number | string } = {}): Promise<ServerStatus & { started: boolean }> {
  const url = resolveUrl({ port: opts.port });
  const apiUrl = resolveApiUrl({ apiPort: opts.apiPort });
  const cur = await status(home, url);
  if (cur.running) return { ...cur, started: false };

  const root = appRoot();
  mkdirSync(home, { recursive: true });
  // The API opens the database on first request — migration is the caller's (bin folds it once).

  const apiCmd = apiStartCommand(root);
  const apiLog = openSync(apiLogPath(home), "a");
  let apiChild: ChildProcess;
  try {
    apiChild = spawn(apiCmd.cmd, apiCmd.args, { cwd: apiCmd.cwd, detached: true, stdio: ["ignore", apiLog, apiLog], env: apiEnv(home, apiUrl) });
  } finally {
    closeSync(apiLog);
  }
  await spawnAndWait(apiChild, apiUrl, apiLogPath(home));
  const apiPid = apiChild.pid!;

  const uiCmd = uiStartCommand(root, home);
  const uiLog = openSync(uiLogPath(home), "a");
  let uiChild: ChildProcess;
  try {
    uiChild = spawn(uiCmd.cmd, uiCmd.args, { cwd: uiCmd.cwd, detached: true, stdio: ["ignore", uiLog, uiLog], env: appEnv(home, url, apiUrl) });
  } finally {
    closeSync(uiLog);
  }
  try {
    await spawnAndWait(uiChild, url, uiLogPath(home));
  } catch (e) {
    try { process.kill(apiPid, "SIGKILL"); } catch { /* already gone */ }
    throw e;
  }

  const startedAt = new Date().toISOString();
  writeState(home, {
    ui: { pid: uiChild.pid!, url, startedAt },
    api: { pid: apiPid, url: apiUrl, startedAt },
  });
  const now = await status(home, url);
  return { ...now, started: true };
}

/** Run both processes in this terminal until they stop (Ctrl-C). For containers and service managers. */
export async function runForeground(home: string, opts: { port?: number | string; apiPort?: number | string } = {}): Promise<number> {
  const url = resolveUrl({ port: opts.port });
  const apiUrl = resolveApiUrl({ apiPort: opts.apiPort });
  const root = appRoot();
  const apiCmd = apiStartCommand(root);
  const uiCmd = uiStartCommand(root, home);
  const api = spawn(apiCmd.cmd, apiCmd.args, { cwd: apiCmd.cwd, stdio: "inherit", env: apiEnv(home, apiUrl) });
  const ui = spawn(uiCmd.cmd, uiCmd.args, { cwd: uiCmd.cwd, stdio: "inherit", env: appEnv(home, url, apiUrl) });
  const forward = (sig: NodeJS.Signals) => () => { api.kill(sig); ui.kill(sig); };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  console.error(`blackboard: serving ${url} (api ${apiUrl})`);
  return new Promise((resolve) => ui.on("exit", (code) => { api.kill("SIGTERM"); resolve(code ?? 0); }));
}

/** Stop the pair this home started. Returns false when there was none; refuses one it did not start. */
export async function stop(home: string): Promise<{ stopped: boolean; note?: string }> {
  const st = readState(home);
  if (!st) {
    const ext = await probe(resolveUrl());
    return { stopped: false, note: ext ? "a Blackboard is answering at that address, but this command did not start it (stop it where you started it)" : undefined };
  }
  for (const proc of [st.ui, st.api]) {
    if (!pidAlive(proc.pid)) continue;
    try { process.kill(proc.pid, "SIGTERM"); } catch { /* already gone */ }
    for (let i = 0; i < 40 && pidAlive(proc.pid); i++) await sleep(150);
    if (pidAlive(proc.pid)) {
      try { process.kill(proc.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
  clearState(home);
  return { stopped: true };
}

export function formatStatus(s: ServerStatus): string {
  if (!s.running) return `not running (${s.url})`;
  if (!s.managed) return `running at ${s.url} (not started by this command)`;
  return [`running at ${s.url}  pid ${s.ui.pid}  since ${s.ui.startedAt}`, `api: running at ${s.api.url}  pid ${s.api.pid}  since ${s.api.startedAt}`, `log: ${s.ui.log}`, `log: ${s.api.log}`].join("\n");
}

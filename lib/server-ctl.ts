import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Running the web app from the `blackboard` command: `serve start | stop | restart | status`, and
 * `open` starting it on first use. The app is the standalone production build shipped in the
 * package's `server/` folder, run by Node, or by Bun when there is no Node. What this module started is
 * remembered in `<home>/server.json`; anything else answering at the same address (a `bun dev`
 * in a clone, say) is treated as running but not ours to stop.
 */
export const DEFAULT_URL = "http://127.0.0.1:38770";

export type ServerState = { pid: number; url: string; startedAt: string };
export type ServerStatus =
  | { running: false; url: string }
  | { running: true; url: string; managed: true; pid: number; startedAt: string; log: string }
  | { running: true; url: string; managed: false };

export class ServerError extends Error {}

export const statePath = (home: string) => join(home, "server.json");
export const logPath = (home: string) => join(home, "server.log");

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

/** The port a URL names (80 / 443 when it names none). */
export function portOf(url: string): number {
  const u = new URL(url);
  return Number(u.port || (u.protocol === "https:" ? 443 : 80));
}

export function readState(home: string): ServerState | null {
  try {
    const v = JSON.parse(readFileSync(statePath(home), "utf8"));
    return Number.isInteger(v?.pid) && typeof v?.url === "string" && typeof v?.startedAt === "string" ? v : null;
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
export function appRoot(from: string = import.meta.url): string {
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
 * The folder to run the app from. npm drops any folder named node_modules from a package, so the
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

/** The command line that starts the production app on `url`, and the folder to run it in. */
export function startCommand(root: string, home: string) {
  const serverDir = join(root, "server");
  if (!existsSync(join(serverDir, "server.js"))) {
    throw new ServerError("this copy has no production build; run `bun run build && bun run build:server` first (or use `bun dev`)");
  }
  const dir = prepareServer(serverDir, home, packageVersion(root));
  const rt = currentRuntime();
  return { cmd: rt.cmd, args: [...rt.args, join(dir, "server.js")], cwd: dir };
}

function appEnv(home: string, url: string): NodeJS.ProcessEnv {
  return { ...process.env, NODE_ENV: "production", BLACKBOARD_HOME: home, BLACKBOARD_URL: url, PORT: String(portOf(url)), HOSTNAME: "127.0.0.1" };
}

export async function status(home: string, url = resolveUrl()): Promise<ServerStatus> {
  const st = readState(home);
  if (st && pidAlive(st.pid) && (await probe(st.url))) {
    return { running: true, url: st.url, managed: true, pid: st.pid, startedAt: st.startedAt, log: logPath(home) };
  }
  if (st) clearState(home); // stale: the process is gone or no longer answers
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

/** Start the app in the background and wait until it answers. Returns the status; a running app is left alone. */
export async function start(home: string, opts: { port?: number | string } = {}): Promise<ServerStatus & { started: boolean }> {
  const url = resolveUrl({ port: opts.port });
  const cur = await status(home, url);
  if (cur.running) return { ...cur, started: false };

  const root = appRoot();
  mkdirSync(home, { recursive: true });
  const { cmd, args, cwd } = startCommand(root, home);
  const log = openSync(logPath(home), "a");
  let child: ChildProcess;
  try {
    child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", log, log], env: appEnv(home, url) });
  } finally {
    closeSync(log);
  }
  let exited: number | null | undefined;
  child.on("exit", (code) => (exited = code ?? -1));
  child.on("error", () => (exited = -1));
  child.unref();
  if (!child.pid) throw new ServerError(`could not start ${cmd}`);
  writeState(home, { pid: child.pid, url, startedAt: new Date().toISOString() });

  for (let i = 0; i < 100; i++) {
    if (exited !== undefined) break;
    if (await probe(url, 500)) {
      const now = await status(home, url);
      return { ...now, started: true };
    }
    await sleep(300);
  }
  clearState(home);
  if (exited === undefined) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  const why = exited !== undefined ? "the server exited" : "the server did not answer within 30 s";
  throw new ServerError(`${why} (${url}). Last log lines (${logPath(home)}):\n${tail(logPath(home))}`);
}

/** Run the app in this terminal until it stops (Ctrl-C). For containers and service managers. */
export async function runForeground(home: string, opts: { port?: number | string } = {}): Promise<number> {
  const url = resolveUrl({ port: opts.port });
  const root = appRoot();
  const { cmd, args, cwd } = startCommand(root, home);
  const child = spawn(cmd, args, { cwd, stdio: "inherit", env: appEnv(home, url) });
  const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  console.error(`blackboard: serving ${url}`);
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

/** Stop the app this home started. Returns false when there was none; refuses one it did not start. */
export async function stop(home: string): Promise<{ stopped: boolean; note?: string }> {
  const st = readState(home);
  if (!st || !pidAlive(st.pid)) {
    clearState(home);
    const ext = await probe(resolveUrl());
    return { stopped: false, note: ext ? "a Blackboard is answering at that address, but this command did not start it (stop it where you started it)" : undefined };
  }
  try {
    process.kill(st.pid, "SIGTERM");
  } catch {
    // already gone
  }
  for (let i = 0; i < 40 && pidAlive(st.pid); i++) await sleep(150);
  if (pidAlive(st.pid)) {
    try {
      process.kill(st.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  clearState(home);
  return { stopped: true };
}

export function formatStatus(s: ServerStatus): string {
  if (!s.running) return `not running (${s.url})`;
  if (!s.managed) return `running at ${s.url} (not started by this command)`;
  return `running at ${s.url}  pid ${s.pid}  since ${s.startedAt}\nlog: ${s.log}`;
}

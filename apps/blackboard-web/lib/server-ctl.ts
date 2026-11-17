/**
 * Running the web app from the `blackboard` command: start, stop, restart, status. The record lives in
 * server-record.ts and the probing in server-status.ts; this file starts and stops the process and formats output.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearState,
  pidAlive,
  portOf,
  readState,
  resolveUrl,
  ServerError,
  type ServerState,
  statePath,
  uiLogPath,
  writeState,
} from "./server-record";
import { portListens, type ServerStatus, status } from "./server-status";

export type { Proc, ServerState } from "./server-record";
export {
  clearState,
  DEFAULT_URL,
  pidAlive,
  portOf,
  readState,
  resolveUrl,
  ServerError,
  statePath,
  uiLogPath,
  writeState,
} from "./server-record";
export { restart } from "./server-restart";
export type { ProcName, ProcState, ServerStatus } from "./server-status";
export { HEALTH_BUDGET_MS, healthAnswers, portListens, procState, status } from "./server-status";

export async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: { app?: string } };
    return body?.data?.app === "blackboard";
  } catch {
    return false;
  }
}

/** The package folder: where the built app (`server/`) and `node_modules` live. Same for the built CLI and the source. */
function appRoot(from: string = import.meta.url): string {
  return dirname(dirname(fileURLToPath(from)));
}

/** Command that runs the built app: Bun only — the API mounts in-process and owns bun:sqlite. */
export function runtimeFor(opts: { execPath: string; pathDirs: string[]; exists: (p: string) => boolean }): {
  cmd: string;
  args: string[];
} {
  if (/^bun/i.test(basename(opts.execPath))) return { cmd: opts.execPath, args: [] };
  for (const d of opts.pathDirs) {
    const p = join(d, process.platform === "win32" ? "bun.exe" : "bun");
    if (opts.exists(p)) return { cmd: p, args: [] };
  }
  return { cmd: opts.execPath, args: [] };
}

const currentRuntime = () =>
  runtimeFor({
    execPath: process.execPath,
    pathDirs: (process.env.PATH ?? "").split(delimiter).filter(Boolean),
    exists: existsSync,
  });

/**
 * Where the app sits inside the assembled server tree: Nitro's node-server preset emits
 * .output/{server,public,nitro.json}, build:server copies that to server/, so the entry is
 * server/server/index.mjs.
 */
const APP_IN_SERVER = join("server");

/** The production app's entry inside an assembled (or copied) server tree. */
const serverEntry = (dir: string) => join(dir, APP_IN_SERVER, "index.mjs");

/**
 * npm drops any folder named node_modules from a package, so the build ships them as `modules` — at
 * both levels. The first start renames them back, which is what makes the app-level
 * `next -> ../../../node_modules/.bun/…` link resolve again.
 */
function restoreModules(dir: string, rename: (from: string, to: string) => void): void {
  for (const base of [dir, join(dir, APP_IN_SERVER)]) {
    const modules = join(base, "modules");
    if (existsSync(modules) && !existsSync(join(base, "node_modules")))
      rename(modules, join(base, "node_modules"));
  }
}

/** The tree exists and nothing is left to rename at either level: it is ready to run. */
const prepared = (dir: string) =>
  existsSync(dir) && ![dir, join(dir, APP_IN_SERVER)].some((base) => existsSync(join(base, "modules")));

/**
 * The folder to run the UI from. When the package folder is read-only (a root-owned global install)
 * the app is copied under `<home>/runtime` and prepared there instead.
 */
export function prepareServer(
  serverDir: string,
  home: string,
  version: string,
  rename: (from: string, to: string) => void = renameSync,
): string {
  if (prepared(serverDir)) return serverDir;
  try {
    restoreModules(serverDir, rename);
    return serverDir;
  } catch {
    const copy = join(home, "runtime", version);
    if (!prepared(copy)) {
      rmSync(copy, { recursive: true, force: true });
      mkdirSync(dirname(copy), { recursive: true });
      cpSync(serverDir, copy, { recursive: true });
      restoreModules(copy, renameSync);
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
  if (!existsSync(serverEntry(serverDir))) {
    throw new ServerError(
      "this copy has no production build; run `bun run build && bun run build:server` first (or use `bun dev`)",
    );
  }
  const dir = prepareServer(serverDir, home, packageVersion(root));
  const rt = currentRuntime();
  // Nitro's entry reads its own neighbours by relative path, so it runs from the tree root.
  return { cmd: rt.cmd, args: [...rt.args, serverEntry(dir)], cwd: dir };
}

function appEnv(home: string, url: string): NodeJS.ProcessEnv {
  // No BLACKBOARD_API_URL: the app's /api/* route mounts the Hono app in-process when it is absent —
  // the one-process fold. Dev's forwarder sets it for the API it runs alongside.
  return {
    ...process.env,
    NODE_ENV: "production",
    BLACKBOARD_HOME: home,
    BLACKBOARD_URL: url,
    PORT: String(portOf(url)),
    HOSTNAME: "127.0.0.1",
  };
}

/**
 * Read the record back and compare it with what was written. A pair that started but whose record cannot be
 * read is reported as a failure, with the pids to stop by hand: a silent "started" would leave them running
 * with nothing recording them.
 */
export function verifyRecord(home: string, expected: ServerState): void {
  const back = readState(home);
  if (back && "ui" in back && back.ui.pid === expected.ui.pid) return;
  throw new ServerError(
    `the server started (pid ${expected.ui.pid}) but ${statePath(home)} did not read back; stop it with: kill ${expected.ui.pid}`,
  );
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

/** Start the app in the background and wait until it answers. A running server is left alone. */
export async function start(
  home: string,
  opts: { port?: number | string } = {},
): Promise<ServerStatus & { started: boolean }> {
  const url = resolveUrl({ port: opts.port });
  const cur = await status(home, url);
  if (cur.running) return { ...cur, started: false };

  const root = appRoot();
  mkdirSync(home, { recursive: true });
  // The API opens the database on first request — migration is the caller's (bin folds it once).

  const uiCmd = uiStartCommand(root, home);
  const uiLog = openSync(uiLogPath(home), "a");
  let uiChild: ChildProcess;
  try {
    uiChild = spawn(uiCmd.cmd, uiCmd.args, {
      cwd: uiCmd.cwd,
      detached: true,
      stdio: ["ignore", uiLog, uiLog],
      env: appEnv(home, url),
    });
  } finally {
    closeSync(uiLog);
  }
  await spawnAndWait(uiChild, url, uiLogPath(home));

  const startedAt = new Date().toISOString();
  const record: ServerState = {
    ui: { pid: uiChild.pid!, url, startedAt },
  };
  writeState(home, record);
  // Success is the record reading back as written, not a probe: a probe can miss a server that is up.
  verifyRecord(home, record);
  // Report what this command started, from the record it just verified. A probe here could miss a server
  // that is up, and then the output would call our own process someone else's.
  return {
    running: true,
    url,
    managed: true,
    degraded: [],
    ui: { ...record.ui, log: uiLogPath(home) },
    started: true,
  };
}

/** Run the app in this terminal until it stops (Ctrl-C). For containers and service managers. */
export async function runForeground(home: string, opts: { port?: number | string } = {}): Promise<number> {
  const url = resolveUrl({ port: opts.port });
  // Foreground has no probe-then-report path: it must refuse a busy port before any spawn,
  // or a foreign process answers as "our app" and the spawn silently takes over its port.
  const port = portOf(url);
  if (await portListens(url, 400)) {
    const pids = listenersOn(port);
    throw new ServerError(
      `port ${port} is already in use${pids.length ? ` by pid ${pids.join(", ")}` : ""} (the app would answer at ${url})`,
    );
  }
  const root = appRoot();
  const uiCmd = uiStartCommand(root, home);
  const ui = spawn(uiCmd.cmd, uiCmd.args, { cwd: uiCmd.cwd, stdio: "inherit", env: appEnv(home, url) });
  console.error(`blackboard: serving ${url}`);
  return new Promise((resolve) => ui.on("exit", (code) => resolve(code ?? 0)));
}

/**
 * The pids that hold a TCP port, from lsof. Read-only: nothing is signalled here. Empty when lsof is missing
 * or finds nothing, so the caller can still say what happened.
 */
export function listenersOn(port: number): number[] {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [
      ...new Set(
        out
          .split(/\s+/)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  } catch {
    return [];
  }
}

/** What `stop` says when a Blackboard answers but this home recorded nothing: the pids, and the command to run. */
export function unrecordedNote(url: string, pids: number[]): string {
  if (pids.length === 0)
    return `a Blackboard answers at ${url}, but this home did not start it and no process could be found on that port (look for it with: lsof -nP -iTCP:${portOf(url)} -sTCP:LISTEN)`;
  return `a Blackboard answers at ${url}, but this home did not start it. Process on that port: pid ${pids.join(", ")}. To stop it, run: kill ${pids.join(" ")}`;
}

/** Wait until nothing accepts a connection on the url's port (~3 s budget). A killed process can
 *  outlive its pid for a moment — a start that probes during that window reads the dying process as a
 *  running pair it did not start, which is how "restarted" printed while the old code still listened.
 *  False only when it is still listening. */
async function portQuiet(url: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (!(await portListens(url, 100))) return true;
    await sleep(150);
  }
  return false;
}

/** Stop the process this home started. `stopped` requires the pid gone AND the recorded port quiet —
 *  anything less is not a stop a restart may build on. Refuses a server it did not start. */
export async function stop(
  home: string,
  at = resolveUrl(),
): Promise<{ stopped: boolean; note?: string; nothing?: boolean }> {
  const st = readState(home);
  if (!st) {
    if (!(await probe(at))) return { stopped: false, nothing: true };
    // Nothing recorded, but a Blackboard answers here. Name the process that holds the port, so the next
    // step is a command the user can run, not a guess about where it was started.
    const pids = listenersOn(portOf(at));
    return { stopped: false, note: unrecordedNote(at, pids) };
  }
  // A pre-split record names one process, a two-process record names two — the kill-and-confirm loop
  // is the same for each pid it names.
  const procs = "legacy" in st ? [st.legacy] : "api" in st ? [st.ui, st.api] : [st.ui];
  for (const proc of procs) {
    if (!pidAlive(proc.pid)) continue;
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 40 && pidAlive(proc.pid); i++) await sleep(150);
    if (pidAlive(proc.pid)) {
      try {
        process.kill(proc.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      for (let i = 0; i < 10 && pidAlive(proc.pid); i++) await sleep(100);
    }
  }
  // The record is ours either way; what decides "stopped" is whether the ports are free of whoever
  // answered on them — including our own pids still closing, or a foreign process squatting the port.
  const quiet = await Promise.all(procs.map((p) => portQuiet(p.url)));
  clearState(home);
  if (quiet.every(Boolean)) return { stopped: true };
  const held = procs.filter((_, i) => !quiet[i]);
  const notes = held.map((p) => unrecordedNote(p.url, listenersOn(portOf(p.url))));
  const word = held.length === 1 ? "a port still listens" : "ports still listen";
  return { stopped: false, note: `the recorded processes are gone but ${word} — ${notes.join("; ")}` };
}

export function formatStatus(s: ServerStatus): string {
  if ("legacy" in s) {
    const p = s.legacy;
    if (p.cleared)
      return `not running (${s.url}): the pid (${p.pid}) is gone — the pre-split record was cleared`;
    const head =
      p.state === "down"
        ? `not running (${s.url}): the recorded pid ${p.pid} is alive but nothing answers`
        : `running at ${s.url}  pid ${p.pid}  since ${p.startedAt}`;
    const advice =
      p.state === "down"
        ? "clear it with: blackboard serve stop"
        : "adopt it with: blackboard serve restart (or: blackboard serve stop)";
    return [head, `a pre-split record (single process, written before the app+api split) — ${advice}`].join(
      "\n",
    );
  }
  if ("pair" in s) {
    const p = s.pair;
    const head =
      p.ui === "running"
        ? `running at ${s.url}  ui pid ${p.pids.ui}`
        : `not running (${s.url}): the recorded UI is ${p.ui}`;
    const apiLine = `api: ${p.api} (pid ${p.pids.api})`;
    const note =
      "a two-process record, written before the fold — restart it with: blackboard serve restart (or: blackboard serve stop)";
    return [head, apiLine, note].join("\n");
  }
  if (!s.running && "partial" in s) {
    return [
      `not running (${s.url}): the recorded process is ${s.partial.ui} (pid ${s.partial.pid})`,
      "run: blackboard serve stop, then blackboard serve start",
    ].join("\n");
  }
  if (!s.running) return `not running (${s.url})`;
  if (!s.managed) return `running at ${s.url} (not started by this command)`;
  const note =
    s.degraded.length === 0
      ? []
      : [
          `degraded: ${s.degraded.join(", ")} is up but slow to answer its health route (it may still be starting)`,
        ];
  return [`running at ${s.url}  pid ${s.ui.pid}  since ${s.ui.startedAt}`, ...note, `log: ${s.ui.log}`].join(
    "\n",
  );
}

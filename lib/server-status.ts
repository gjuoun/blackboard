/**
 * What `serve status` says about the pair this home recorded: running, degraded (a process listens but answers late),
 * or down. Built on the record, and on nothing else in the serve code.
 */
import { connect as netConnect } from "node:net";
import { clearState, pidAlive, portOf, readState, uiLogPath, apiLogPath, resolveUrl, type Proc } from "./server-record";

/** One process as status sees it. `degraded`: its port accepts connections but the app does not answer in time. */
export type ProcState = "running" | "degraded" | "down";

export type ProcName = "ui" | "api";

export type ServerStatus =
  | { running: false; url: string }
  | { running: true; url: string; managed: true; degraded: ProcName[]; ui: Proc & { log: string }; api: Proc & { log: string } }
  | { running: true; url: string; managed: false }
  | { running: false; url: string; partial: { ui: ProcState; api: ProcState; pids: { ui: number; api: number } } }
  | { running: boolean; url: string; legacy: Proc & { state: ProcState; cleared: boolean } };

/**
 * True when something answers HTTP at `url`, whatever the status. The UI process proves it is alive by
 * answering at all: its pages return 500 when the API it fetches from is down, and that must still read
 * as "the UI is up" for `status`, or a dead API would hide a live UI.
 */
/** Budget for one process to answer its health route. Long enough for a cold API or a slow first render. */
export const HEALTH_BUDGET_MS = 5000;

/** True when a TCP connection to the URL's host and port is accepted. No HTTP: a slow app still listens. */
export function portListens(url: string, timeoutMs = 1500): Promise<boolean> {
  const u = new URL(url);
  return new Promise((resolve) => {
    const sock = netConnect({ host: u.hostname, port: portOf(url) });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** True when `${url}/api/health` answers as a Blackboard within `timeoutMs`. Both processes answer it in milliseconds. */
export async function healthAnswers(url: string, timeoutMs = HEALTH_BUDGET_MS): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    return (await res.json())?.app === "blackboard";
  } catch {
    return false;
  }
}

/**
 * One process, in three states. `down`: its pid is gone, or nothing accepts a connection on its port. `degraded`:
 * the pid is alive and the port accepts connections, but the health route did not answer within the budget (slow,
 * or busy). `running`: the health route answered. A slow process is never down.
 */
export async function procState(pid: number, url: string): Promise<ProcState> {
  if (!pidAlive(pid)) return "down";
  if (!(await portListens(url))) return "down";
  return (await healthAnswers(url)) ? "running" : "degraded";
}

/**
 * How long a pair gets to answer before it is called down. A cold start of the API (a large registry) or
 * the UI (its first compile) can take longer than one probe, so a single miss is not evidence of anything.
 */
/**
 * The state of the pair this home recorded. A record is cleared only when neither pid exists: a live process that
 * does not answer yet is starting or slow, and the record is the only proof that this home started it.
 */
export async function status(home: string, url = resolveUrl()): Promise<ServerStatus> {
  const st = readState(home);
  if (st && "legacy" in st) {
    // A pre-split record names one process. A dead pid makes it stale — drop it like the pair's
    // record — but a live pid is ours: status reports it and stop/restart can still reach it.
    if (!pidAlive(st.legacy.pid)) {
      clearState(home);
      return { running: false, url: st.legacy.url, legacy: { ...st.legacy, state: "down", cleared: true } };
    }
    const proc = await procState(st.legacy.pid, st.legacy.url);
    return { running: proc !== "down", url: st.legacy.url, legacy: { ...st.legacy, state: proc, cleared: false } };
  }
  if (st) {
    if (!pidAlive(st.ui.pid) && !pidAlive(st.api.pid)) {
      clearState(home);
    } else {
      const [ui, api] = await Promise.all([procState(st.ui.pid, st.ui.url), procState(st.api.pid, st.api.url)]);
      if (ui !== "down" && api !== "down") {
        const degraded: ProcName[] = [];
        if (ui === "degraded") degraded.push("ui");
        if (api === "degraded") degraded.push("api");
        return { running: true, url: st.ui.url, managed: true, degraded, ui: { ...st.ui, log: uiLogPath(home) }, api: { ...st.api, log: apiLogPath(home) } };
      }
      return { running: false, url, partial: { ui, api, pids: { ui: st.ui.pid, api: st.api.pid } } };
    }
  }
  return (await healthAnswers(url, 1500)) ? { running: true, url, managed: false } : { running: false, url };
}

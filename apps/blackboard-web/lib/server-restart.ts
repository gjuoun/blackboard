/**
 * `serve restart`: stop the recorded pair, then start a fresh one. Unlike a bare stop-then-start
 * sequence, an unconfirmed stop or a start that finds the port already held is an error, never a
 * printed "restarted". The start implementation is injectable for tests; production callers get
 * `server-ctl.start`.
 */
import { listenersOn, resolveUrl, ServerError, start, stop, unrecordedNote } from "./server-ctl";
import { portOf } from "./server-record";
import type { ServerStatus } from "./server-status";

export async function restart(
  home: string,
  opts: { port?: number | string; apiPort?: number | string } = {},
  impl: { start?: typeof start } = {},
): Promise<ServerStatus & { started: boolean }> {
  const stopped = await stop(home, resolveUrl({ port: opts.port }));
  // `nothing` means nothing was running anywhere: a fresh start, not a failed stop — proceed.
  if (!stopped.stopped && !stopped.nothing) {
    throw new ServerError(`cannot restart: the running pair was not stopped${stopped.note ? ` — ${stopped.note}` : ""}`);
  }
  const run = impl.start ?? start;
  const r = await run(home, { port: opts.port, apiPort: opts.apiPort });
  if (!r.started) {
    const url = resolveUrl({ port: opts.port });
    throw new ServerError(`cannot restart: ${unrecordedNote(url, listenersOn(portOf(url)))}`);
  }
  return r;
}

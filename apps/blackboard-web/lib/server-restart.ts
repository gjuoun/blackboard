/**
 * `serve restart`: stop the recorded pair, then start a fresh one. Unlike a bare stop-then-start
 * sequence, an unconfirmed stop or a start that finds the port already held is an error, never a
 * printed "restarted". The start implementation is injectable for tests; production callers get
 * `server-ctl.start`.
 */
import { listenersOn, resolveUrl, ServerError, start, stop, unrecordedNote } from "./server-ctl";
import { portOf, readState } from "./server-record";
import type { ServerStatus } from "./server-status";

/** The port this home's record names — the url the running server answers on, in any record shape. */
function recordedPort(home: string): number | undefined {
  const st = readState(home);
  if (!st) return undefined;
  return portOf("legacy" in st ? st.legacy.url : st.ui.url);
}

export async function restart(
  home: string,
  opts: { port?: number | string } = {},
  impl: { start?: typeof start } = {},
): Promise<ServerStatus & { started: boolean }> {
  // A bare `serve restart` means "the server I already have", so its port comes from the record the
  // same way `serve status` reads it. Resolving the default here instead stopped a server on 38790
  // and then tried to start on 38770 — leaving nothing running and an EADDRINUSE behind.
  const port = opts.port ?? recordedPort(home);
  const stopped = await stop(home, resolveUrl({ port }));
  // `nothing` means nothing was running anywhere: a fresh start, not a failed stop — proceed.
  if (!stopped.stopped && !stopped.nothing) {
    throw new ServerError(`cannot restart: the running server was not stopped${stopped.note ? ` — ${stopped.note}` : ""}`);
  }
  const run = impl.start ?? start;
  const r = await run(home, { port });
  if (!r.started) {
    const url = resolveUrl({ port });
    throw new ServerError(`cannot restart: ${unrecordedNote(url, listenersOn(portOf(url)))}`);
  }
  return r;
}

/**
 * The options the API process hands Bun when it starts from this module's default export.
 *
 * `idleTimeout: 0` is load-bearing: Bun closes a connection that has sent nothing for 10 s by
 * default, which is exactly what an SSE watch stream looks like between two changes — the page
 * then reconnects every ~12 s and loses updates in the gap. The stream sends a `: ping` every
 * 15 s, but a heartbeat slower than the idle timeout can never save the connection, so the
 * timeout is off and liveness is the heartbeat's job.
 */
export function apiServeOptions(port: number, fetch: (request: Request) => Response | Promise<Response>) {
  return { port, hostname: "127.0.0.1", idleTimeout: 0, fetch };
}
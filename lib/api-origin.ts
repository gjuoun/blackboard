/**
 * Where the Next server reaches the API: BLACKBOARD_API_URL, else the API this home recorded in
 * server.json, else the default API port. Imported by server code only (app/ route handlers and
 * server components). The URL is never sent to the browser.
 */
import { readState } from "./server-ctl";

const DEFAULT_API = "http://127.0.0.1:38771";

export function apiOrigin(home: string): string {
  const env = process.env.BLACKBOARD_API_URL;
  if (env) return env.replace(/\/+$/, "");
  const st = readState(home);
  // A pre-split single-pid record names no API — fall through to the default port.
  return (st && "api" in st ? st.api.url : DEFAULT_API).replace(/\/+$/, "");
}

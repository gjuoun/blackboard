/**
 * Where a server-side caller reaches the API: `$BLACKBOARD_API_URL` (dev's second process), else the
 * URL this home recorded in `server.json`, else nothing. One resolver — the CLI, the UI's forwarder
 * and the server components all read it instead of each keeping their own fallback. The URL never
 * reaches the browser: every caller of this module is a server module.
 */
import { DEFAULT_URL, readState } from "./server-ctl";

const trim = (url: string): string => url.replace(/\/+$/, "");

/** What answered the question, so a caller can tell "recorded" from "nothing there". */
export type ApiTarget = {
  readonly url: string | null;
  readonly source: "env" | "record" | "none";
};

export function apiTarget(home: string): ApiTarget {
  const env = process.env.BLACKBOARD_API_URL;
  if (env) return { url: trim(env), source: "env" };
  const st = readState(home);
  // A two-process record names its own API; a one-process or pre-split record means the API shares
  // the app's port.
  if (st && "api" in st) return { url: trim(st.api.url), source: "record" };
  if (st && "ui" in st) return { url: trim(st.ui.url), source: "record" };
  return { url: null, source: "none" };
}

/** The API for a home, or null when nothing is recorded: no URL beats guessing another home's port. */
export const apiUrl = (home: string): string | null => apiTarget(home).url;

/** The app's own origin, used when no API is recorded: `$BLACKBOARD_URL`, else the product default. */
export const appOrigin = (): string => trim(process.env.BLACKBOARD_URL || DEFAULT_URL);

/** Where a server component reaches the API: the home's target, else the app's own port. */
export const apiOrigin = (home: string): string => apiUrl(home) ?? appOrigin();

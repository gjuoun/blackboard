/**
 * Where the app server reaches the API: BLACKBOARD_API_URL (dev's second process), else the URL this
 * home recorded in server.json — the api proc when a two-process record names one, the app's own
 * port when it does not. The URL is never sent to the browser.
 */
import { DEFAULT_URL, readState } from "./server-ctl";

export function apiOrigin(home: string): string {
  const env = process.env.BLACKBOARD_API_URL;
  if (env) return env.replace(/\/+$/, "");
  const st = readState(home);
  // A two-process record names its API; a one-process or pre-split record means the API shares the
  // app's port — fall through to the app's own default when nothing is recorded at all.
  return (st && "api" in st ? st.api.url : st && "ui" in st ? st.ui.url : DEFAULT_URL).replace(/\/+$/, "");
}

import { app } from "./app";
import { apiServeOptions } from "./serve-options";

/**
 * The API process entry point, dev only. Bun only — storage is bun:sqlite. The production app mounts
 * the same `app` in-process (`bun .output/server/index.mjs`); this file is what `vite dev` runs
 * alongside so `BLACKBOARD_API_URL` has somewhere to forward.
 */

const DEFAULT_PORT = 38771;

const port = (() => {
  const fromUrl = process.env.BLACKBOARD_API_URL;
  if (fromUrl) return Number(new URL(fromUrl).port || DEFAULT_PORT);
  const raw = process.env.PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : DEFAULT_PORT;
})();

// No process-wide file watcher: every read through the session store stats its file and
// re-indexes when it changed, and an open page's SSE connection watches its own doc.
export default apiServeOptions(port, app.fetch);

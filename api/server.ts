import { app } from "./app";
import { apiServeOptions } from "./serve-options";

/**
 * The API process entry point. Bun only — storage is bun:sqlite. `blackboard serve` spawns this
 * file (or the bundled dist/api.mjs); dev can run `bun api/server.ts` directly.
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

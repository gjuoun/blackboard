import { app } from "./app";
import { runtime } from "../lib/effect/runtime";
import { getHome } from "../lib/home";
import { startDocWatch } from "../lib/doc-watch";

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

// Keep the database current with the files it indexed, whether or not a page is open on them.
const stopWatch = startDocWatch(getHome(), (effect) => runtime.runPromise(effect as never));
process.on("exit", stopWatch);

const server = {
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};

export default server;

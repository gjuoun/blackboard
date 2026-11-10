// Bundles api/server.ts into dist/api.mjs. Target stays "bun": the API is the one process that
// owns bun:sqlite, so the bundle runs under Bun by design.
import { chmodSync } from "node:fs";

const result = await Bun.build({
  entrypoints: ["api/server.ts"],
  outdir: "dist",
  naming: "api.mjs",
  target: "bun",
  format: "esm",
  external: ["bun:sqlite"],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
chmodSync("dist/api.mjs", 0o755);
console.log("built dist/api.mjs");

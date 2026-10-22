// Bundles bin/blackboard.ts into dist/blackboard.mjs so the command runs on plain Node as well as Bun.
import { chmodSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["bin/blackboard.ts"],
  outdir: "dist",
  naming: "blackboard.mjs",
  target: "node",
  format: "esm",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
chmodSync("dist/blackboard.mjs", 0o755);
console.log("built dist/blackboard.mjs");

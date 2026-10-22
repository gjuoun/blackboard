// Assembles server/: the self-contained production app that `blackboard serve` runs.
// `next build` (output: "standalone") leaves .next/standalone with its own node_modules, but npm
// never packs a folder called node_modules, so it ships as `modules` and lib/server-ctl.ts puts the
// name back on first start.
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";

const src = ".next/standalone";
if (!existsSync(`${src}/server.js`)) {
  console.error("no .next/standalone: run `bun run build` first");
  process.exit(1);
}
rmSync("server", { recursive: true, force: true });
cpSync(src, "server", { recursive: true });
mkdirSync("server/.next", { recursive: true });
cpSync(".next/static", "server/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", "server/public", { recursive: true });
for (const junk of ["bun.lock", "lib"]) rmSync(`server/${junk}`, { recursive: true, force: true });
renameSync("server/node_modules", "server/modules");
console.log("built server/");

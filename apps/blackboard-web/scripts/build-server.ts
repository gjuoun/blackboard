// Assembles server/: the self-contained production app that `blackboard serve` runs.
//
// A workspace sits above the app, so `next build` roots its standalone output at the workspace
// root: `.next/standalone/apps/blackboard-web/{server.js,.next}` plus `.next/standalone/node_modules`
// for the traced dependencies. `server/` is that tree as it came out — lib/server-ctl.ts knows the
// entry is `apps/blackboard-web/server.js`.
//
// npm never packs a folder called node_modules, so both levels ship as `modules` and the first
// start renames them back.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = ".next/standalone";
const APP = join("apps", "blackboard-web");
const srcApp = join(src, APP);

if (!existsSync(join(srcApp, "server.js"))) {
  console.error(`no ${srcApp}/server.js: run \`bun run build\` first`);
  process.exit(1);
}

rmSync("server", { recursive: true, force: true });
cpSync(src, "server", { recursive: true });

// The standalone tree carries the server chunks but never the static assets; the app dir is where
// the server looks for them.
mkdirSync(join("server", APP, ".next"), { recursive: true });
cpSync(".next/static", join("server", APP, ".next", "static"), { recursive: true });
if (existsSync("public")) cpSync("public", join("server", APP, "public"), { recursive: true });

// The trace copies the project root into the tree — the source trees, the dev configs and the
// previous build's leftovers. Strip them at both levels so the npm pack ships only what the server
// runs. `app/` and `components/` stay: they are small and were never in the strip list.
const JUNK = [
  "sketches", "test", "docs", "scripts", "packages", "lib", "api", "bin", "dist", "server", "bun.lock",
  "eslint.config.mjs", "components.json", "drizzle.config.ts", "proxy.ts", "bunfig.toml", "tsconfig.json",
  "postcss.config.mjs", "README.md", "LICENSE",
];
for (const base of ["server", join("server", APP)]) {
  if (!existsSync(base)) continue;
  for (const junk of JUNK) rmSync(join(base, junk), { recursive: true, force: true });
  for (const file of readdirSync(base)) {
    if (file.endsWith(".tsbuildinfo")) rmSync(join(base, file), { force: true });
  }
}

for (const base of ["server", join("server", APP)]) {
  const modules = join(base, "node_modules");
  if (existsSync(modules)) renameSync(modules, join(base, "modules"));
}
console.log("built server/");
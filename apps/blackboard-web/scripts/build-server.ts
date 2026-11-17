// Assembles server/: the self-contained production app that `blackboard serve` runs.
//
// Nitro's node-server preset emits .output/{server,public,nitro.json}; server/index.mjs is the entry
// and reads its neighbours by relative path, so the whole directory is the artifact. `server/` is
// that tree as it came out — lib/server-ctl.ts knows the entry is `server/index.mjs`.
//
// npm never packs a folder called node_modules, so both levels ship as `modules` and the first
// start renames them back.
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = ".output";
const entry = join(src, "server", "index.mjs");

if (!existsSync(entry)) {
  console.error(`no ${entry}: run \`bun run build\` first`);
  process.exit(1);
}

rmSync("server", { recursive: true, force: true });
cpSync(src, "server", { recursive: true });

// The trace copies the project root into the tree — the source trees, the dev configs and the
// previous build's leftovers. Strip them at both levels so the npm pack ships only what the server
// runs.
const JUNK = [
  "sketches",
  "test",
  "docs",
  "scripts",
  "packages",
  "lib",
  "api",
  "bin",
  "dist",
  "bun.lock",
  "components.json",
  "drizzle.config.ts",
  "proxy.ts",
  "bunfig.toml",
  "tsconfig.json",
  "postcss.config.mjs",
  "README.md",
  "LICENSE",
  "vite.config.mts",
  "tsr.config.json",
];
for (const base of ["server", join("server", "server")]) {
  if (!existsSync(base)) continue;
  for (const junk of JUNK) rmSync(join(base, junk), { recursive: true, force: true });
  for (const file of readdirSync(base)) {
    if (file.endsWith(".tsbuildinfo")) rmSync(join(base, file), { force: true });
  }
}

for (const base of ["server", join("server", "server")]) {
  const modules = join(base, "node_modules");
  if (existsSync(modules)) renameSync(modules, join(base, "modules"));
}
console.log("built server/");

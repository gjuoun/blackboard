import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temp BLACKBOARD_ROOT shaped like the real kanban folders: one board, hidden and escape traps. */
export function makeFixtureRoot() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-test-")));
  const root = join(base, "root");
  const demo = join(root, "demo");
  mkdirSync(join(demo, "research"), { recursive: true });
  mkdirSync(join(demo, ".hidden"), { recursive: true });
  mkdirSync(join(demo, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, "empty-board"), { recursive: true });
  writeFileSync(join(root, "loose.md"), "# not a board\n");
  writeFileSync(join(demo, "design.md"), "# Design\n");
  writeFileSync(join(demo, "brief.md"), "# Brief\n");
  writeFileSync(join(demo, "notes.txt"), "not markdown\n");
  writeFileSync(join(demo, "research", "notes.md"), "# Notes\n");
  writeFileSync(join(demo, ".hidden", "secret.md"), "# Secret\n");
  writeFileSync(join(demo, "node_modules", "pkg", "README.md"), "# dep\n");
  writeFileSync(join(base, "outside.md"), "root:x:0:0\n");
  symlinkSync(join(base, "outside.md"), join(demo, "escape.md"));
  symlinkSync(base, join(demo, "escape-dir"));
  return { base, root, demo };
}

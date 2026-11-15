import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** "~/x" -> "$HOME/x". Only a leading "~" is expanded. */
export function expandHome(p: string): string {
  return p.replace(/^~(?=$|\/)/, process.env.HOME || homedir());
}

/**
 * Blackboard's own folder: the session registry, each session's comments, the scratchpad.
 * `--home`, then BLACKBOARD_HOME, then ~/.blackboard. Created when missing.
 */
export function getHome(explicit?: string): string {
  const raw = explicit || process.env.BLACKBOARD_HOME || join(process.env.HOME || homedir(), ".blackboard");
  const dir = resolve(expandHome(raw));
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

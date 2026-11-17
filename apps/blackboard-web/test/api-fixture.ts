import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "../lib/cli/sessions";
import { run, services } from "./app";

/**
 * A temp Blackboard home and docs folder for the API route tests. BLACKBOARD_HOME is set here, so
 * nothing reads or writes the real ~/.blackboard. `files` are written into the docs folder.
 */
export async function fixture(prefix: string, files: Record<string, string>) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(docs, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(docs, name), text);
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  return { base, home, docs };
}

/** Register a doc, returning its session id and path. */
export async function register(home: string, path: string) {
  const { session } = await run(open(services.sessions, home, path));
  return session;
}

/** The loopback host every request names, so the guard admits it as a local request. */
export const LOCAL = { host: "127.0.0.1" };

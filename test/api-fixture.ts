import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./app";
import { open } from "../lib/cli/sessions";

/**
 * A temp Blackboard home and docs folder for the API route tests. BLACKBOARD_HOME is set here, so
 * nothing reads or writes the real ~/.blackboard. `files` are written into the docs folder.
 */
export async function fixture(prefix: string, files: Record<string, string>) {
  const base = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix }));
    }),
  );
  const home = join(base, "home");
  const docs = join(base, "docs");
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(docs, { recursive: true });
      for (const [name, text] of Object.entries(files)) yield* fs.writeFileString(join(docs, name), text);
    }),
  );
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  return { base, home, docs };
}

/** Register a doc, returning its session id and path. */
export async function register(home: string, path: string) {
  const { session } = await run(open(home, path));
  return session;
}

/** The loopback host every request names, so the guard admits it as a local request. */
export const LOCAL = { host: "127.0.0.1" };

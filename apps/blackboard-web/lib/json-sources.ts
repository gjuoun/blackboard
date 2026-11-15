import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentsFile } from "./agents-store";
import { readComments, type CommentFile } from "./comments-store";
import { readReadingState, type ReadingFile } from "./reading-state";
import { SessionError, sessionCommentsPath, type Registry } from "./sessions";

/**
 * The four JSON-era stores as plain file reads. Nothing in the app reads these any more — the
 * data layer replaced them — but `lib/db/migrate.ts` still needs the formats to move a pre-SQLite
 * home into blackboard.db, and `docs` stays the comment-key convention for that one purpose.
 */

const SESSION_ID = /^[a-z0-9]{1,32}$/;

/** sessions.json as a value; a file that does not parse is an error, never silently replaced. */
export function readRegistryFile(home: string): Registry {
  const p = join(home, "sessions.json");
  if (!existsSync(p)) return { version: 1, sessions: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.sessions)) throw new SessionError(`unsupported session registry: ${p}`);
  return data as Registry;
}

/** A comments.json as a value; missing reads as empty, a file that does not parse is an error. */
export const readCommentsFile = (p: string): CommentFile => readComments(p);

/** Every session comments file on disk. */
export function commentFiles(home: string): string[] {
  const dir = join(home, "sessions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((id) => SESSION_ID.test(id) && existsSync(sessionCommentsPath(home, id)))
    .map((id) => sessionCommentsPath(home, id));
}

/** reading-state.json as a value; missing reads as empty. */
export const readReadingFile = (p: string): ReadingFile => readReadingState(p);

/** agents.json as a value; missing reads as empty. */
export function readAgentsFile(home: string): AgentsFile {
  const p = join(home, "agents.json");
  if (!existsSync(p)) return { version: 1, agents: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.agents)) throw new Error(`unsupported agents file: ${p}`);
  return data as AgentsFile;
}

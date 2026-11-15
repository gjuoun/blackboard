import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { AgentsRepo } from "./db/repos/agents";
import type { DbFailure } from "./effect/errors";

/**
 * A document bound to the pi session that opened it. The pi extension posts this record, and the
 * API posts each new comment to `url`, so the session that owns the doc hears about it. Since the
 * data-layer round the record lives in `blackboard.db`'s `agents` table; `agents.json` is only
 * migration input now.
 */
export type Binding = {
  /** The Blackboard session id. */
  session: string;
  /** The real path of the doc, so a reader of the file knows what is bound. */
  path: string;
  /** The pi session id the extension belongs to. */
  piSession: string;
  /** The loopback url the extension listens on, e.g. http://127.0.0.1:51234. */
  url: string;
  boundAt: string;
  /** Last time the extension asked about its own binding. */
  lastSeenAt: string;
};

export type AgentsFile = { version: 1; agents: Binding[] };
/** A binding as it is posted: the stamps are the store's business. */
export type BindInput = Omit<Binding, "boundAt" | "lastSeenAt">;

/** `<home>/agents.json` — the migration source only; the app no longer reads it. */
export function readAgents(home: string): AgentsFile {
  const p = join(home, "agents.json");
  if (!existsSync(p)) return { version: 1, agents: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.agents)) throw new Error(`unsupported agents file: ${p}`);
  return data as AgentsFile;
}

/** The bindings, backed by the agents table. */
export class AgentsStore extends Context.Service<
  AgentsStore,
  {
    get(home: string, session: string): Effect.Effect<Binding | null, DbFailure>;
    /** One record per session: binding again replaces the record. */
    bind(home: string, input: BindInput): Effect.Effect<Binding, DbFailure>;
    unbind(home: string, session: string): Effect.Effect<Binding | null, DbFailure>;
    /** The extension asked about its binding: record that it is still there. */
    touch(home: string, session: string): Effect.Effect<void, DbFailure>;
  }
>()("blackboard/AgentsStore") {}

export const layer = Layer.effect(
  AgentsStore,
  Effect.gen(function* () {
    const repo = yield* AgentsRepo;
    return AgentsStore.of({
      get: (home, session) => repo.get(home, session),
      bind: (home, input) => repo.bind(home, input),
      unbind: (home, session) => repo.unbind(home, session),
      touch: (home, session) => repo.touch(home, session),
    });
  }),
);

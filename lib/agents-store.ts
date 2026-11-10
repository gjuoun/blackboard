import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { errorMessage, IoFailure, type LockTimeout } from "./effect/errors";
import { Lock } from "./lock";

/**
 * A document bound to the pi session that opened it. The pi extension posts this record, and the
 * server posts each new comment to `url`, so the session that owns the doc hears about it.
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

const now = () => new Date().toISOString();
const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** `<home>/agents.json`: plain JSON, so anyone can read the bindings straight from disk. */
const agentsPath = (home: string) => join(home, "agents.json");

/** The bindings as JSON; a file that does not parse is an error, never silently replaced. */
export function readAgents(home: string): AgentsFile {
  const p = agentsPath(home);
  if (!existsSync(p)) return { version: 1, agents: [] };
  const data = JSON.parse(readFileSync(p, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.agents)) throw new Error(`unsupported agents file: ${p}`);
  return data as AgentsFile;
}

function writeAtomic(p: string, data: AgentsFile) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, p);
}

/** The bindings, under the same cross-process lock and atomic rename the session registry uses. */
export class AgentsStore extends Context.Service<
  AgentsStore,
  {
    get(home: string, session: string): Effect.Effect<Binding | null, IoFailure>;
    /** One record per session: binding again replaces the record. */
    bind(home: string, input: BindInput): Effect.Effect<Binding, IoFailure | LockTimeout>;
    unbind(home: string, session: string): Effect.Effect<Binding | null, IoFailure | LockTimeout>;
    /** The extension asked about its binding: record that it is still there. */
    touch(home: string, session: string): Effect.Effect<void, IoFailure | LockTimeout>;
  }
>()("blackboard/AgentsStore") {}

export const layer = Layer.effect(
  AgentsStore,
  Effect.gen(function* () {
    const lock = yield* Lock;

    const get = (home: string, session: string) =>
      Effect.try({
        try: () => readAgents(home).agents.find((b) => b.session === session) ?? null,
        catch: failure,
      });

    const update = <A>(home: string, change: (file: AgentsFile) => A): Effect.Effect<A, IoFailure | LockTimeout> =>
      Effect.gen(function* () {
        yield* Effect.sync(() => mkdirSync(home, { recursive: true }));
        return yield* lock.withLock(
          agentsPath(home),
          Effect.try({
            try: () => {
              const file = readAgents(home);
              const out = change(file);
              writeAtomic(agentsPath(home), file);
              return out;
            },
            catch: failure,
          }),
        );
      });

    return AgentsStore.of({
      get,
      bind: (home, input) =>
        update(home, (file) => {
          const bound: Binding = { ...input, boundAt: now(), lastSeenAt: now() };
          const at = file.agents.findIndex((b) => b.session === input.session);
          if (at >= 0) file.agents[at] = bound;
          else file.agents.push(bound);
          return bound;
        }),
      unbind: (home, session) =>
        update(home, (file) => {
          const found = file.agents.find((b) => b.session === session) ?? null;
          file.agents = file.agents.filter((b) => b.session !== session);
          return found;
        }),
      touch: (home, session) =>
        update(home, (file) => {
          const found = file.agents.find((b) => b.session === session);
          if (found) found.lastSeenAt = now();
        }),
    });
  }),
);

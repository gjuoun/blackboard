import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { Db } from "../client";
import { agents } from "../schema";
import type { DbFailure } from "../../effect/errors";

/** A doc-to-pi-session binding (the old agents.json record). */
export type AgentRow = typeof agents.$inferSelect;
export type AgentInput = Omit<AgentRow, "boundAt" | "lastSeenAt">;

const now = () => new Date().toISOString();

/** The agents table: one binding per session, binding again replaces it. */
export class AgentsRepo extends Context.Service<
  AgentsRepo,
  {
    get(home: string, session: string): Effect.Effect<AgentRow | null, DbFailure>;
    bind(home: string, input: AgentInput): Effect.Effect<AgentRow, DbFailure>;
    unbind(home: string, session: string): Effect.Effect<AgentRow | null, DbFailure>;
    touch(home: string, session: string): Effect.Effect<void, DbFailure>;
    list(home: string): Effect.Effect<AgentRow[], DbFailure>;
  }
>()("blackboard/AgentsRepo") {}

export const layer = Layer.effect(
  AgentsRepo,
  Effect.gen(function* () {
    const db = yield* Db;
    return AgentsRepo.of({
      get: (home, session) => db.use(home, (d) => d.select().from(agents).where(eq(agents.session, session)).get() ?? null),
      bind: (home, input) =>
        db.use(home, (d) => {
          const row: AgentRow = { ...input, boundAt: now(), lastSeenAt: now() };
          d.insert(agents).values(row).onConflictDoUpdate({ target: agents.session, set: row }).run();
          return row;
        }),
      unbind: (home, session) =>
        db.use(home, (d) => {
          const found = d.select().from(agents).where(eq(agents.session, session)).get() ?? null;
          if (found) d.delete(agents).where(eq(agents.session, session)).run();
          return found;
        }),
      touch: (home, session) => db.use(home, (d) => void d.update(agents).set({ lastSeenAt: now() }).where(eq(agents.session, session)).run()),
      list: (home) => db.use(home, (d) => d.select().from(agents).all()),
    });
  }),
);

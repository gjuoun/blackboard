import { Safe } from "@gjuoun/safe-ts";
import { eq } from "drizzle-orm";
import type { DbFailure } from "../../errors";
import type { Db } from "../client";
import { agents } from "../schema";

/** A doc-to-pi-session binding (the old agents.json record). */
export type AgentRow = typeof agents.$inferSelect;
export type AgentInput = Omit<AgentRow, "boundAt" | "lastSeenAt">;

const now = () => new Date().toISOString();

/** The agents table: one binding per session, binding again replaces it. */
export class AgentsRepo {
  constructor(private readonly db: Db) {}

  get(home: string, session: string): Safe<AgentRow | null, DbFailure> {
    return this.db.use(home, (d) => d.select().from(agents).where(eq(agents.session, session)).get() ?? null);
  }

  bind(home: string, input: AgentInput): Safe<AgentRow, DbFailure> {
    return this.db.use(home, (d) => {
      const row: AgentRow = { ...input, boundAt: now(), lastSeenAt: now() };
      d.insert(agents).values(row).onConflictDoUpdate({ target: agents.session, set: row }).run();
      return row;
    });
  }

  unbind(home: string, session: string): Safe<AgentRow | null, DbFailure> {
    return this.db.use(home, (d) => {
      const found = d.select().from(agents).where(eq(agents.session, session)).get() ?? null;
      if (found) d.delete(agents).where(eq(agents.session, session)).run();
      return found;
    });
  }

  touch(home: string, session: string): Safe<void, DbFailure> {
    return this.db.use(home, (d) => {
      d.update(agents).set({ lastSeenAt: now() }).where(eq(agents.session, session)).run();
    });
  }

  list(home: string): Safe<AgentRow[], DbFailure> {
    return this.db.use(home, (d) => d.select().from(agents).all());
  }
}
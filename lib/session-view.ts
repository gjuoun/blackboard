import { Effect } from "effect";
import { runtime } from "./effect/runtime";
import { SCRATCHPAD_ID, SessionsStore, type Session, type SessionRow } from "./sessions";

/**: The session and its row, creating the scratchpad on first use; null when the id names no session. */
export function loadSession(home: string, id: string): Promise<{ session: Session; row: SessionRow } | null> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      if (id === SCRATCHPAD_ID) yield* sessions.scratchpad(home);
      const session = yield* sessions.get(home, id);
      if (!session) return null;
      return { session, row: yield* sessions.row(home, session) };
    }),
  );
}


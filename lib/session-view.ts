import { Effect } from "effect";
import { runtime } from "./effect/runtime";
import { SCRATCHPAD_ID, SessionsStore, type Session, type SessionRow } from "./sessions";
import { workspacePane, type WorkspacePane } from "./workspace-pane";

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

/** The 工作区 pane for one request, read through the same runtime as the registry. */
export function loadWorkspacePane(repoRoot: string | null, relPath: string | null, home: string): Promise<WorkspacePane> {
  return runtime.runPromise(workspacePane(repoRoot, relPath, home));
}

/** The stream the top-bar timeline button opens: the most recently opened stream session, or null. */
export function streamHref(home: string): Promise<string | null> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      const found = (yield* sessions.list(home)).filter((x) => x.kind === "stream").sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
      return found ? `/s/${found.id}` : null;
    }),
  );
}
/**
 * The data behind the 工作区 pane for one request: the repo file list (from the cached index) and the
 * registered sessions keyed by their repo-relative path. Both are read once here, before rendering starts.
 */
import { Effect } from "effect";
import { IoFailure } from "./effect/errors";
import { SessionsStore, type Session } from "./sessions";
import { buildWorkspaceIndex } from "./workspace-index";
import { workspaceTree, type TreeNode } from "./workspace-tree";

export type WorkspacePane =
  | { state: "outside-git" }
  | { state: "ready"; tree: TreeNode[]; current: string; sessionByPath: Map<string, string> };

/**
 * `repoRoot` and `relPath` come from the current document repo. `sessions` is the registry read by
 * the page. Only registered sessions inside the same repo count.
 */
export function workspacePane(
  repoRoot: string | null,
  relPath: string | null,
  home: string,
): Effect.Effect<WorkspacePane, IoFailure, SessionsStore> {
  if (!repoRoot || !relPath) return Effect.succeed({ state: "outside-git" });
  const index = buildWorkspaceIndex(repoRoot);
  if (!index) return Effect.succeed({ state: "outside-git" });
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const sessionByPath = new Map<string, string>();
    for (const s of yield* sessions.list(home)) collect(s, repoRoot, sessionByPath);
    return { state: "ready", tree: workspaceTree(index.files), current: relPath, sessionByPath };
  });
}

function collect(s: Session, repoRoot: string, into: Map<string, string>) {
  if (!s.path.startsWith(repoRoot + "/")) return;
  into.set(s.path.slice(repoRoot.length + 1), s.id);
}
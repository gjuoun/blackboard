/**
 * The data behind the 工作区 pane for one request: the repo's file list (from the cached index) and the
 * registered sessions keyed by their repo-relative path. Both are read once here, before rendering starts.
 */
import { buildWorkspaceIndex } from "./workspace-index";
import { workspaceTree, type TreeNode } from "./workspace-tree";
import { listSessions, type Session } from "./sessions";

export type WorkspacePane =
  | { state: "outside-git" }
  | { state: "ready"; tree: TreeNode[]; current: string; sessionByPath: Map<string, string> };

/**
 * `repoRoot` and `relPath` come from the current document's repo. `sessions` is the registry read by
 * the page. Only registered sessions inside the same repo count.
 */
export function workspacePane(repoRoot: string | null, relPath: string | null, home: string): WorkspacePane {
  if (!repoRoot || !relPath) return { state: "outside-git" };
  const index = buildWorkspaceIndex(repoRoot);
  if (!index) return { state: "outside-git" };
  const sessionByPath = new Map<string, string>();
  for (const s of listSessions(home)) collect(s, repoRoot, sessionByPath);
  return { state: "ready", tree: workspaceTree(index.files), current: relPath, sessionByPath };
}

function collect(s: Session, repoRoot: string, into: Map<string, string>) {
  if (!s.path.startsWith(repoRoot + "/")) return;
  into.set(s.path.slice(repoRoot.length + 1), s.id);
}

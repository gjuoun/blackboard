/**
 * A flat list of repo paths, nested into folders for the workspace tree. Pure: no filesystem access.
 * Folders come before files at each level; both are sorted by name.
 */

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string };

export function workspaceTree(files: readonly string[]): TreeNode[] {
  const root: { dirs: Map<string, unknown>; files: string[] } = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.split("/");
    let at = root;
    for (const dir of parts.slice(0, -1)) {
      let next = at.dirs.get(dir) as typeof root | undefined;
      if (!next) {
        next = { dirs: new Map(), files: [] };
        at.dirs.set(dir, next);
      }
      at = next;
    }
    at.files.push(f);
  }
  const build = (node: typeof root, prefix: string): TreeNode[] => {
    const dirs = [...node.dirs.keys()].sort().map((name) => {
      const path = prefix + name;
      return { kind: "dir" as const, name, path, children: build(node.dirs.get(name) as typeof root, path + "/") };
    });
    const files = [...node.files].sort().map((path) => ({ kind: "file" as const, name: path.slice(prefix.length), path }));
    return [...dirs, ...files];
  };
  return build(root, "");
}

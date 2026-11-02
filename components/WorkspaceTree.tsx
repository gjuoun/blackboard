import type { TreeNode } from "@/lib/workspace-tree";

/**
 * The workspace tree as nested folders. A folder is a `<details>` that opens when it lies on the path
 * to the current file. The current file carries `aria-current="page"`. A file links to its session only
 * when it is already registered; other files are plain text, so a click never lands on a 404.
 */
export function WorkspaceTree({
  nodes,
  current,
  sessionByPath,
}: {
  nodes: readonly TreeNode[];
  current: string;
  sessionByPath: ReadonlyMap<string, string>;
}) {
  return (
    <ul className="workspace-tree m-0 list-none p-0 text-[13px]" data-testid="workspace-tree">
      {nodes.map((n) => (
        <TreeItem key={n.path} node={n} current={current} sessionByPath={sessionByPath} />
      ))}
    </ul>
  );
}

function TreeItem({ node, current, sessionByPath }: { node: TreeNode; current: string; sessionByPath: ReadonlyMap<string, string> }) {
  if (node.kind === "dir") {
    const open = current === node.path || current.startsWith(node.path + "/");
    return (
      <li>
        <details open={open}>
          <summary className="cursor-pointer py-0.5 text-muted-foreground">{node.name}/</summary>
          <ul className="m-0 list-none p-0 pl-3">
            {node.children.map((c) => (
              <TreeItem key={c.path} node={c} current={current} sessionByPath={sessionByPath} />
            ))}
          </ul>
        </details>
      </li>
    );
  }
  const sessionId = sessionByPath.get(node.path);
  const isCurrent = node.path === current;
  const label = isCurrent ? <span aria-current="page" className="font-semibold text-foreground">{node.name}</span> : node.name;
  return (
    <li className="py-0.5" data-testid="workspace-file" data-path={node.path}>
      {sessionId && !isCurrent ? <a href={`/s/${sessionId}`} className="text-primary">{node.name}</a> : label}
    </li>
  );
}

import Link from "next/link";
import { docHref } from "@/lib/boards";

type Folder = { name: string; path: string; docs: string[]; folders: Folder[] };

/** Nest flat "a/b/c.md" paths into folders, keeping listDocs order. */
function buildTree(docs: string[]): Folder {
  const root: Folder = { name: "", path: "", docs: [], folders: [] };
  for (const doc of docs) {
    const parts = doc.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      let child = node.folders.find((f) => f.name === part);
      if (!child) {
        child = { name: part, path, docs: [], folders: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.docs.push(doc);
  }
  return root;
}

function FolderView({ board, folder, current }: { board: string; folder: Folder; current: string }) {
  return (
    <ul>
      {folder.docs.map((doc) => (
        <li key={doc}>
          <Link href={docHref(board, doc)} aria-current={doc === current ? "page" : undefined}>
            {doc.split("/").at(-1)}
          </Link>
        </li>
      ))}
      {folder.folders.map((f) => (
        <li key={f.path}>
          <details open>
            <summary>{f.name}/</summary>
            <FolderView board={board} folder={f} current={current} />
          </details>
        </li>
      ))}
    </ul>
  );
}

export function FileTree({ board, docs, current }: { board: string; docs: string[]; current: string }) {
  return (
    <nav className="file-tree" data-testid="file-tree" aria-label="Files">
      <h2>Files</h2>
      <FolderView board={board} folder={buildTree(docs)} current={current} />
    </nav>
  );
}

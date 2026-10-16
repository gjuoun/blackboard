import { readFileSync } from "node:fs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocBody } from "@/components/DocBody";
import { FileTree } from "@/components/FileTree";
import { Toc } from "@/components/Toc";
import { listDocs, resolveBoard, resolveDoc } from "@/lib/boards";
import { renderMarkdown } from "@/lib/markdown";
import { getRoot } from "@/lib/paths";

export default async function DocPage({ params }: PageProps<"/b/[board]/[...doc]">) {
  const { board: rawBoard, doc: rawDoc } = await params;
  const board = decodeURIComponent(rawBoard);
  const doc = rawDoc.map((s) => decodeURIComponent(s)).join("/");
  const root = getRoot();
  const file = resolveDoc(root, board, doc);
  const boardDir = resolveBoard(root, board);
  if (!file || !boardDir) notFound();

  const { html, toc } = await renderMarkdown(readFileSync(file, "utf8"));
  return (
    <div className="doc-layout">
      <header className="top-nav">
        <Link href="/">Blackboard</Link>
        <span className="crumb">/</span>
        <span>{board}</span>
        <span className="crumb">/</span>
        <span className="muted">{doc}</span>
      </header>
      <aside className="sidebar">
        <FileTree board={board} docs={listDocs(boardDir)} current={doc} />
        <Toc toc={toc} />
      </aside>
      <main className="doc-main">
        <DocBody html={html} />
      </main>
    </div>
  );
}

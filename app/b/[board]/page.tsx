import { notFound, redirect } from "next/navigation";
import { docHref, listDocs, resolveBoard } from "@/lib/boards";
import { getRoot } from "@/lib/paths";

const PREFERRED = ["issue.md", "brief.md", "README.md", "index.md"];

/** A board URL opens its main doc: issue.md for kanban cards, brief.md for new boards. */
export default async function BoardPage({ params }: PageProps<"/b/[board]">) {
  const { board } = await params;
  const name = decodeURIComponent(board);
  const dir = resolveBoard(getRoot(), name);
  if (!dir) notFound();
  const docs = listDocs(dir);
  const first = PREFERRED.find((p) => docs.includes(p)) ?? docs[0];
  if (!first) {
    return (
      <main className="home">
        <h1>{name}</h1>
        <p className="muted">This board has no markdown files yet.</p>
      </main>
    );
  }
  redirect(docHref(name, first));
}

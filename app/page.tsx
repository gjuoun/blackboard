import Link from "next/link";
import { connection } from "next/server";
import { listBoards } from "@/lib/boards";
import { getRoot } from "@/lib/paths";

export default async function Home() {
  await connection();
  const root = getRoot();
  const boards = listBoards(root);
  return (
    <main className="home">
      <header className="home-header">
        <h1>Blackboard</h1>
        <p className="muted">{root}</p>
      </header>
      {boards.length === 0 ? <p className="muted">No boards yet.</p> : null}
      <ul className="board-grid">
        {boards.map((b) => (
          <li key={b.name}>
            <Link className="board-card" data-testid="board-card" href={`/b/${encodeURIComponent(b.name)}`}>
              <strong>{b.name}</strong>
              <span className="muted">
                {b.docCount} {b.docCount === 1 ? "doc" : "docs"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

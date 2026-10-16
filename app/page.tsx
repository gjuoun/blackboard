import Link from "next/link";
import { connection } from "next/server";
import { getHome } from "@/lib/home";
import { SCRATCHPAD_ID, sessionRows } from "@/lib/sessions";

export default async function Home() {
  await connection();
  const rows = sessionRows(getHome()).filter((r) => r.id !== SCRATCHPAD_ID);
  return (
    <main className="home">
      <header className="home-header">
        <h1>Sessions</h1>
      </header>
      {rows.length === 0 ? (
        <p className="muted">
          No sessions yet. Run <code>blackboard open &lt;file&gt;</code>.
        </p>
      ) : null}
      <ul className="board-grid">
        {rows.map((r) => (
          <li key={r.id}>
            <Link className="board-card" data-testid="session-row" href={`/s/${r.id}`}>
              <strong>{r.title}</strong>
              <span className="muted">{r.location}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

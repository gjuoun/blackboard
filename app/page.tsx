import Link from "next/link";
import { connection } from "next/server";
import { SessionTable, type HomeRow, type HomeSort } from "@/components/SessionTable";
import { getHome } from "@/lib/home";
import { relativeTime, shortDateTime } from "@/lib/relative-time";
import { SCRATCHPAD_ID, scratchpadSession, sessionRow, sessionRows } from "@/lib/sessions";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Everything Home shows, with times already formatted so server and browser render the same text. */
function homeData(now = Date.now()) {
  const home = getHome();
  const pad = sessionRow(home, scratchpadSession(home));
  const rows: HomeRow[] = sessionRows(home)
    .filter((r) => r.id !== SCRATCHPAD_ID)
    .map((r) => ({
      id: r.id,
      title: r.title,
      location: r.location,
      path: r.path,
      repo: r.repo?.name ?? null,
      branch: r.branch,
      open: r.open,
      missing: r.missing,
      createdAt: r.createdAt,
      created: shortDateTime(r.createdAt),
      updatedAt: r.updatedAt,
      updated: relativeTime(r.updatedAt, now),
    }));
  const padSummary = `${plural(pad.stats.sections, "section")} · ${plural(pad.stats.diagrams, "diagram")} · updated ${relativeTime(pad.updatedAt, now)}`;
  return { rows, padSummary };
}

/** Home: the scratchpad pinned on top, then every session with where it lives and its branch. */
export default async function Home({ searchParams }: PageProps<"/">) {
  await connection();
  const { rows, padSummary } = homeData();
  const q = await searchParams;
  const sort = one(q.sort);
  return (
    <main className="home">
      <header className="home-header">
        <h1>Sessions</h1>
      </header>
      <Link className="scratchpad-card" data-testid="scratchpad-card" href={`/s/${SCRATCHPAD_ID}`}>
        <strong>✎ Scratchpad</strong>
        <span className="muted">{padSummary}</span>
      </Link>
      <SessionTable
        rows={rows}
        initial={{ q: one(q.q), repo: one(q.repo), sort: (["updated", "created", "title"].includes(sort) ? sort : "updated") as HomeSort }}
      />
    </main>
  );
}

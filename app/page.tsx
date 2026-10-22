import { connection } from "next/server";
import { SessionTable, type HomeRow, type HomeSort } from "@/components/SessionTable";
import { getHome } from "@/lib/home";
import { groupOf } from "@/lib/home-groups";
import { relativeTime, shortDateTime } from "@/lib/relative-time";
import { SCRATCHPAD_ID, scratchpadSession, sessionRow, sessionRows } from "@/lib/sessions";

// The title template covers child routes only, so Home spells its own.
export const metadata = { title: { absolute: "Sessions · Blackboard" } };

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
      group: groupOf(r.updatedAt, now),
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
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 md:px-6 md:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Sessions</h1>
        <p className="text-muted-foreground text-sm">Local markdown review</p>
      </header>
      <SessionTable
        rows={rows}
        pad={{ href: `/s/${SCRATCHPAD_ID}`, summary: padSummary }}
        initial={{ q: one(q.q), repo: one(q.repo), sort: (["updated", "created", "title"].includes(sort) ? sort : "updated") as HomeSort }}
      />
    </main>
  );
}

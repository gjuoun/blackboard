import { basename } from "node:path";
import { Effect } from "effect";
import { connection } from "next/server";
import { getHome } from "@/lib/home";
import { drawable, ogCard, OG_SIZE, OG_TYPE } from "@/app/_og/render";
import { runtime } from "@/lib/effect/runtime";
import { SCRATCHPAD_ID, SessionsStore } from "@/lib/sessions";

export const alt = "A document on Blackboard";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Share card for one doc: its title (or file name when the title has characters the card cannot draw). */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const home = getHome();
  const row = await runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* SessionsStore;
      if (id === SCRATCHPAD_ID) yield* sessions.scratchpad(home);
      const session = yield* sessions.get(home, id);
      if (!session) return null;
      return yield* sessions.row(home, session);
    }),
  );
  if (!row) return ogCard({ title: "Blackboard", line: "Review markdown with your coding agent." });
  const file = basename(row.path);
  const title = drawable(row.title) ? row.title : drawable(file) ? file : "Document";
  return ogCard({ title, line: `${row.stats.sections} sections · ${row.stats.diagrams} diagrams · ${row.open} open comments` });
}
import { basename } from "node:path";
import { connection } from "next/server";
import { getHome } from "@/lib/home";
import { drawable, ogCard, OG_SIZE, OG_TYPE } from "@/lib/og";
import { getSession, SCRATCHPAD_ID, scratchpadSession, sessionRow } from "@/lib/sessions";

export const alt = "A document on Blackboard";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Share card for one doc: its title (or file name when the title has characters the card cannot draw). */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const home = getHome();
  if (id === SCRATCHPAD_ID) scratchpadSession(home);
  const session = getSession(home, id);
  if (!session) return ogCard({ title: "Blackboard", line: "Review markdown with your coding agent." });
  const row = sessionRow(home, session);
  const file = basename(session.path);
  const title = drawable(row.title) ? row.title : drawable(file) ? file : "Document";
  return ogCard({ title, line: `${row.stats.sections} sections · ${row.stats.diagrams} diagrams · ${row.open} open comments` });
}

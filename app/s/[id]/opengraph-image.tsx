import { basename } from "node:path";
import { connection } from "next/server";
import { drawable, ogCard, OG_SIZE, OG_TYPE } from "@/app/_og/render";
import { apiGetJson } from "@/lib/api-fetch";
import { getHome } from "@/lib/home";
import type { SessionRow } from "@/lib/sessions";

export const alt = "A document on Blackboard";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Share card for one doc: its title (or file name when the title has characters the card cannot draw). */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const home = getHome();
  const detail = await apiGetJson<{ row: SessionRow }>(home, `/api/session?id=${encodeURIComponent(id)}`).catch(() => null);
  const row = detail?.row ?? null;
  if (!row) return ogCard({ title: "Blackboard", line: "Review markdown with your coding agent." });
  const file = basename(row.path);
  const title = drawable(row.title) ? row.title : drawable(file) ? file : "Document";
  return ogCard({ title, line: `${row.stats.sections} sections · ${row.stats.diagrams} diagrams · ${row.open} open comments` });
}

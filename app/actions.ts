"use server";

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { docHref } from "@/lib/boards";
import { getRoot, resolveSafe } from "@/lib/paths";
import { slugify } from "@/lib/slug";

const TEMPLATE_DIR = join(process.cwd(), "templates", "board");

export type NewBoardState = { error: string | null; topic: string };

/** Create <root>/<slug>/ from templates/board, filling in the topic and date, then open it. */
export async function createBoard(_prev: NewBoardState, form: FormData): Promise<NewBoardState> {
  const topic = String(form.get("topic") ?? "").trim();
  const slug = slugify(topic);
  if (!slug) return { error: "Give the board a name with at least one letter or number.", topic };
  const dir = resolveSafe(getRoot(), slug);
  if (!dir) return { error: "That name is not allowed.", topic };
  if (existsSync(dir)) return { error: `A board named "${slug}" already exists.`, topic };

  mkdirSync(dir);
  const date = new Date().toISOString().slice(0, 10);
  for (const name of readdirSync(TEMPLATE_DIR)) {
    const src = join(TEMPLATE_DIR, name);
    if (!name.endsWith(".md")) {
      cpSync(src, join(dir, name), { recursive: true });
      continue;
    }
    const text = readFileSync(src, "utf8").replaceAll("{{title}}", topic).replaceAll("{{date}}", date);
    writeFileSync(join(dir, name), text, { flag: "wx" });
  }
  redirect(docHref(slug, "brief.md"));
}

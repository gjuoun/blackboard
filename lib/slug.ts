const MAX = 60;

/** Folder name for a board topic: lowercase ASCII words joined by "-". Null when nothing is left. */
export function slugify(topic: string): string | null {
  const s = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    .replace(/-+$/, "");
  return s || null;
}

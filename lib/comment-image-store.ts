/** Where comment images are kept on disk: `<home>/comment-images/<sha256>.<ext>`. */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptImage, IMAGE_ID } from "./comment-images";

const imageDir = (home: string) => join(home, "comment-images");

/** Stores a valid image and returns its id. Same bytes, same id, so a second upload is a no-op. */
export function saveImage(home: string, bytes: Uint8Array): { ok: true; id: string; mime: string } | { ok: false; error: string } {
  const r = acceptImage(bytes);
  if (!r.ok) return r;
  const dir = imageDir(home);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, r.name);
  if (!existsSync(p)) writeFileSync(p, bytes);
  return { ok: true, id: r.name, mime: r.mime };
}

/** The bytes of a stored image, or null for an id that is not a stored image name. */
export function readImage(home: string, id: string): Uint8Array | null {
  if (!IMAGE_ID.test(id)) return null;
  const p = join(imageDir(home), id);
  return existsSync(p) ? readFileSync(p) : null;
}

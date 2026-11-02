/**
 * Images attached to comments. A file is accepted only when its first bytes are a known image signature
 * (png, jpeg, gif, webp); the name the client sent is ignored. Stored by content hash, so the same
 * picture is kept once and its id is a stable name.
 */
import { createHash } from "node:crypto";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_ID = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/;

export type ImageKind = { ext: "png" | "jpg" | "gif" | "webp"; mime: string };

/** The kind a buffer's leading bytes name, or null for anything else (svg, html, text, binaries). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { ext: "png", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: "gif", mime: "image/gif" };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: "webp", mime: "image/webp" };
  return null;
}

/** Validates an upload. Returns the stored name, or the reason it is refused. */
export function acceptImage(bytes: Uint8Array): { ok: true; name: string; mime: string } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: "empty file" };
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, error: "over 5 MB" };
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, error: "not a png, jpeg, gif or webp image" };
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { ok: true, name: `${hash}.${kind.ext}`, mime: kind.mime };
}

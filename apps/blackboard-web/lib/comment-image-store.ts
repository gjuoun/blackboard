/** Where comment images are kept on disk: `<home>/comment-images/<sha256>.<ext>`. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { acceptImage, IMAGE_ID } from "./comment-images";
import { errorMessage, ImageRejected, IoFailure } from "./errors";

const imageDir = (home: string) => join(home, "comment-images");

const ioFailure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** Stores a valid image and returns its id. Same bytes, same id, so a second upload is a no-op. */
export function saveImage(
  home: string,
  bytes: Uint8Array,
): Safe<{ id: string; mime: string }, ImageRejected | IoFailure> {
  return Safe.try(function* () {
    const accepted = acceptImage(bytes);
    if (!accepted.ok) {
      return (yield Safe.err(new ImageRejected({ message: accepted.error, status: 400 }))) as never;
    }
    const dir = imageDir(home);
    const path = join(dir, accepted.name);
    yield Safe.call(() => {
      mkdirSync(dir, { recursive: true });
      if (!existsSync(path)) writeFileSync(path, bytes);
    }, ioFailure);
    return { id: accepted.name, mime: accepted.mime };
  });
}

/** The bytes of a stored image, or null for an id that is not a stored image name. */
export function readImage(home: string, id: string): Safe<Uint8Array | null, IoFailure> {
  return Safe.try(function* () {
    if (!IMAGE_ID.test(id)) return null;
    const path = join(imageDir(home), id);
    // No file means no image; the caller has always called that a missing image.
    if (!existsSync(path)) return null;
    return (yield Safe.call(() => new Uint8Array(readFileSync(path)), ioFailure)) as Uint8Array;
  });
}
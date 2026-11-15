/** Where comment images are kept on disk: `<home>/comment-images/<sha256>.<ext>`. */
import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { acceptImage, IMAGE_ID } from "./comment-images";
import { errorMessage, ImageRejected, IoFailure } from "./effect/errors";

const imageDir = (home: string) => join(home, "comment-images");

const ioFailure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });

/** Stores a valid image and returns its id. Same bytes, same id, so a second upload is a no-op. */
export function saveImage(home: string, bytes: Uint8Array) {
  return Effect.gen(function* () {
    const accepted = acceptImage(bytes);
    if (!accepted.ok) return yield* Effect.fail(new ImageRejected({ message: accepted.error, status: 400 }));
    const fs = yield* FileSystem.FileSystem;
    const dir = imageDir(home);
    const path = join(dir, accepted.name);
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(ioFailure));
    const stored = yield* fs.exists(path).pipe(Effect.mapError(ioFailure));
    if (!stored) yield* fs.writeFile(path, bytes).pipe(Effect.mapError(ioFailure));
    return { id: accepted.name, mime: accepted.mime };
  });
}

/** The bytes of a stored image, or null for an id that is not a stored image name. */
export function readImage(home: string, id: string) {
  return Effect.gen(function* () {
    if (!IMAGE_ID.test(id)) return null;
    const fs = yield* FileSystem.FileSystem;
    const path = join(imageDir(home), id);
    // A stat that failed means the file is not there; the caller has always called that a missing image.
    const stored = yield* fs.stat(path).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!stored) return null;
    return yield* fs.readFile(path).pipe(Effect.mapError(ioFailure));
  });
}

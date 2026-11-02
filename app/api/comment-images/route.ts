import { Effect, FileSystem } from "effect";
import type { NextRequest } from "next/server";
import { errorMessage, IoFailure, type ApiFailure } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { saveImage } from "@/lib/comment-image-store";
import { getHome } from "@/lib/home";

function program(req: NextRequest): Effect.Effect<{ id: string }, ApiFailure, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => req.arrayBuffer(),
      catch: (error) => new IoFailure({ message: errorMessage(error), status: 500 }),
    });
    const saved = yield* saveImage(getHome(), new Uint8Array(raw));
    return { id: saved.id };
  });
}

/** POST raw image bytes. The bytes are sniffed; the Content-Type the client sent is ignored. Returns the stored id. */
export async function POST(req: NextRequest) {
  return respond(program(req));
}

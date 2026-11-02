import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import { IMAGE_ID } from "@/lib/comment-images";
import { readImage } from "@/lib/comment-image-store";
import { IoFailure, type ApiFailure } from "@/lib/effect/errors";
import { respondRaw } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const notFound = (): Effect.Effect<never, ApiFailure> => Effect.fail(new IoFailure({ message: "not found", status: 404 }));

function program(params: Promise<{ id: string }>): Effect.Effect<Response, ApiFailure> {
  return Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => params);
    if (!IMAGE_ID.test(id)) return yield* notFound();
    const bytes = yield* Effect.sync(() => readImage(getHome(), id));
    if (!bytes) return yield* notFound();
    const ext = id.slice(id.lastIndexOf(".") + 1);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "content-type": MIME[ext], "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable" },
    });
  });
}

/** GET one stored image. The id must match the sha256 name pattern; anything else is a 404. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return respondRaw(program(params));
}

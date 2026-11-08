import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { sessionNotFound } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";
import { previewDoc } from "@/lib/reading-workspace";

/** GET /api/reading/doc?session= — the document rendered for the preview, plus its general-comment thread. */
export async function GET(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const data = yield* previewDoc(getHome(), req.nextUrl.searchParams.get("session") ?? "");
      if (!data) return yield* Effect.fail(sessionNotFound(400));
      return data;
    }),
  );
}

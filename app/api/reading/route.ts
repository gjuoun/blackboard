import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { InvalidInput, sessionNotFound } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { decodeBody, jsonBody, ReadingPostBody, readingReject } from "@/lib/effect/schema";
import { getHome } from "@/lib/home";
import { applyReading } from "@/lib/reading-workspace";

/**
 * POST /api/reading {session, action, progress?}
 * action: read | unread | progress (one document), or read-all (every document).
 * Answers the entries that changed, keyed by session id.
 */
export async function POST(req: NextRequest) {
  return respond(
    Effect.gen(function* () {
      const raw = yield* jsonBody(req);
      if (raw === null) return yield* Effect.fail(sessionNotFound(400));
      const body = yield* decodeBody(ReadingPostBody, raw, readingReject);
      if (!body.action) return yield* Effect.fail(new InvalidInput({ message: "unknown action", status: 400, field: "action" }));
      return yield* applyReading(getHome(), { session: body.session, action: body.action, progress: body.progress });
    }),
  );
}

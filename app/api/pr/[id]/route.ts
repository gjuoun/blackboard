import { Effect } from "effect";
import type { CommentsStore } from "@/lib/comments-store";
import { sessionNotFound, type ApiFailure } from "@/lib/effect/errors";
import { respond } from "@/lib/effect/respond";
import { getHome } from "@/lib/home";
import { prStatus, type PrStatus } from "@/lib/pr-status";
import type { SessionsStore } from "@/lib/sessions";

function program(params: Promise<{ id: string }>): Effect.Effect<PrStatus, ApiFailure, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const { id } = yield* Effect.promise(() => params);
    const status = yield* prStatus(getHome(), id);
    if (!status) return yield* Effect.fail(sessionNotFound(404));
    return status;
  });
}

/**
 * The same payload as "blackboard pr <session> --json": front matter, the pinned base, the exact
 * git command, files/totals and open comments. SDKs read this instead of the CLI text output.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(program(params));
}
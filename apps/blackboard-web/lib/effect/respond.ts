import { Effect } from "effect";
import { errorMessage, type ApiFailure } from "./errors";
import type { AppServices } from "./layers";
import { runtime } from "./runtime";

/** Every way a program can end, settled into a value so nothing escapes as a rejection. */
type Outcome<B> =
  | { readonly kind: "ok"; readonly body: B }
  | { readonly kind: "failure"; readonly failure: ApiFailure }
  | { readonly kind: "defect"; readonly defect: unknown };

function settle<B>(effect: Effect.Effect<B, ApiFailure, AppServices>): Effect.Effect<Outcome<B>, never, AppServices> {
  return effect.pipe(
    Effect.map((body): Outcome<B> => ({ kind: "ok", body })),
    Effect.catch((failure): Effect.Effect<Outcome<B>> => Effect.succeed({ kind: "failure", failure })),
    Effect.catchDefect((defect): Effect.Effect<Outcome<B>> => Effect.succeed({ kind: "defect", defect })),
  );
}

/** Run a program and answer with JSON: the body on success, {error} for a failure or a defect. */
export async function respond<B>(effect: Effect.Effect<B, ApiFailure, AppServices>, status = 200): Promise<Response> {
  const outcome = await runtime.runPromise(settle(effect));
  if (outcome.kind === "ok") return Response.json(outcome.body, { status });
  if (outcome.kind === "failure") return Response.json({ error: outcome.failure.message }, { status: outcome.failure.status });
  return Response.json({ error: errorMessage(outcome.defect) }, { status: 500 });
}

/** Run a program whose success is already a whole Response (bytes, an event stream). */
export async function respondRaw(effect: Effect.Effect<Response, ApiFailure, AppServices>): Promise<Response> {
  const outcome = await runtime.runPromise(settle(effect));
  if (outcome.kind === "ok") return outcome.body;
  if (outcome.kind === "failure") return new Response(outcome.failure.message, { status: outcome.failure.status });
  return new Response(errorMessage(outcome.defect), { status: 500 });
}
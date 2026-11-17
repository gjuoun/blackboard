import { Runtime, type Safe } from "@gjuoun/safe-ts";
import type { Context } from "hono";
import type { TypedResponse } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { JSONParsed } from "hono/utils/types";
import { HttpFailure } from "./http.failure";

/**
 * The wire envelope: `{success:true,data}` or `{success:false,error:{code,message,details?}}`. The
 * boolean `success` is the discriminator; `status` rides on the HTTP head and never in the body.
 */
export type SuccessEnvelope<A> = { readonly success: true; readonly data: A };
export type ErrorEnvelope = {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
};

/**
 * What a failure union can answer with, as a literal union. `Errors.define` puts `status` on every
 * variant, so this reads it back out instead of restating it at the route.
 */
export type EnvelopeFailure = Record<
  string,
  { readonly status: ContentfulStatusCode; readonly message: string }
>;
export type StatusOf<E> = E extends Record<string, { readonly status: infer S }> ? S : never;

export type JsonResponse<T, S extends ContentfulStatusCode> = Response &
  TypedResponse<JSONParsed<T>, S, "json">;

/** The union a handler may return: the success arm, or any status its failure union can produce. */
export type JsonExit<A, E extends EnvelopeFailure> =
  | JsonResponse<SuccessEnvelope<A>, 200>
  | JsonResponse<ErrorEnvelope, StatusOf<E>>;

/**
 * Run a `Safe` and answer with JSON. Success becomes the success arm; a failure or a defect is
 * thrown as `HttpFailure` so `app.onError` builds the body in one place. The run is cancelled when
 * the client disconnects (`c.req.raw.signal`), so a dropped browser does not leave work running.
 */
export async function json<A, E extends EnvelopeFailure>(
  c: Context,
  safe: Safe<A, E>,
): Promise<JsonExit<A, E>> {
  const outcome = await Runtime.run(safe, { signal: c.req.raw.signal });
  if (outcome._tag === "success") {
    // The one cast: `A` is generic here, so the JSONValue shape Hono wants cannot be proven at this
    // call site. The wire shape itself is asserted by the test below.
    const body: SuccessEnvelope<A> = { success: true, data: outcome.value };
    return c.json(body, 200) as unknown as JsonExit<A, E>;
  }
  if (outcome._tag === "fail") throw new HttpFailure(outcome.error as EnvelopeFailure);
  throw HttpFailure.defect(outcome._tag === "die" ? outcome.defect : "interrupted");
}

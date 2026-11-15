import { Cause, Effect, Exit, Result } from "effect";
import type { AppServices } from "@/lib/effect/layers";
import { runtime } from "@/lib/effect/runtime";

/** Run a program the way a route or the CLI does, with AppLayer already provided. */
export const run = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> => runtime.runPromise(effect);

/** The same for a read-only program: the value, or the typed failure thrown as itself. */
export const runSync = <A, E>(effect: Effect.Effect<A, E, AppServices>): A => {
  const exit = runtime.runSyncExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findError(exit.cause);
  throw Result.isSuccess(failure) ? failure.success : Cause.squash(exit.cause);
};
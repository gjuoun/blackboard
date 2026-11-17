import { Runtime, type Safe } from "@gjuoun/safe-ts";
import { bootstrap } from "../lib/bootstrap";

/**
 * The dependency graph every test runs against, built once per test process: a `Db` that opens
 * nothing until a store touches it, the repos over it, and the stores over those.
 */
export const services = bootstrap();

/**
 * Run a program the way a route or the CLI does. A declared failure is thrown as itself (so a test
 * asserts on the value, not on a wrapper), a defect is thrown as its cause.
 */
export const run = async <A, E>(safe: Safe<A, E>): Promise<A> => {
  const outcome = await Runtime.run(safe);
  if (outcome._tag === "success") return outcome.value as A;
  if (outcome._tag === "fail") throw asThrown(outcome.error);
  throw outcome._tag === "die" ? (outcome as { defect: unknown }).defect : new Error("interrupted");
};

/**
 * A catalog failure as the value a test throws on: an Error carrying the payload message, with the
 * failure itself on .failure, so toThrow(/…/) and a structural assertion both work.
 */
const asThrown = (failure: unknown): Error => {
  const [tag, payload] = Object.entries(failure as Record<string, { message?: string }>)[0] ?? [
    "Failure",
    {},
  ];
  const error = new Error(payload.message ?? tag) as Error & { failure?: unknown; tag?: string };
  error.failure = failure;
  error.tag = tag;
  return error;
};

/** The same, for a test that wants the outcome arms rather than a throw. */
export const outcomeOf = <A, E>(safe: Safe<A, E>) => Runtime.run(safe);

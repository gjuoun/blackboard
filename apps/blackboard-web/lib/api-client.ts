import { Data, Effect } from "effect";
import { readState } from "./server-ctl";

/** No API URL for this home: nothing answers for it, so nothing was written. */
export class ApiUnreachable extends Data.TaggedError("ApiUnreachable")<{ readonly message: string }> {}

/** The API answered with an error: the write did not happen, and the message is the reason. */
export class ApiRefused extends Data.TaggedError("ApiRefused")<{ readonly message: string }> {}

export type ApiFailure = ApiUnreachable | ApiRefused;

const NOT_RUNNING = "the API is not running — start it with: blackboard serve start";

/**
 * Where the API for this home answers: $BLACKBOARD_API_URL, else the URL the running `serve` recorded
 * in this home's server.json. There is no default port: a test or a second home must never reach
 * an API that belongs to some other home.
 */
export function apiUrl(home: string): string | null {
  const env = process.env.BLACKBOARD_API_URL;
  if (env) return env.replace(/\/+$/, "");
  const st = readState(home);
  // A pre-split single-pid record names no API — no URL beats guessing another home's port.
  return st && "api" in st ? st.api.url.replace(/\/+$/, "") : null;
}

const messageOf = (data: unknown, fallback: string): string => {
  const e = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  return typeof e === "string" ? e : fallback;
};

/** One request to the API for this home. A connection failure is ApiUnreachable; an HTTP error is ApiRefused. */
export function apiRequest(home: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Effect.Effect<unknown, ApiFailure> {
  return Effect.gen(function* () {
    const base = apiUrl(home);
    if (!base) return yield* Effect.fail(new ApiUnreachable({ message: NOT_RUNNING }));
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(`${base}${path}`, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        }),
      catch: () => new ApiUnreachable({ message: `${NOT_RUNNING} (${base})` }),
    });
    const text = yield* Effect.tryPromise({
      try: () => res.text(),
      catch: () => new ApiUnreachable({ message: `${NOT_RUNNING} (${base})` }),
    });
    const data = yield* Effect.try({
      try: () => (text === "" ? null : (JSON.parse(text) as unknown)),
      catch: () => new ApiRefused({ message: text || res.statusText }),
    });
    if (!res.ok) return yield* Effect.fail(new ApiRefused({ message: messageOf(data, res.statusText) }));
    return data;
  });
}

export const apiGet = (home: string, path: string) => apiRequest(home, "GET", path);
export const apiPost = (home: string, path: string, body: unknown) => apiRequest(home, "POST", path, body);
export const apiPatch = (home: string, path: string, body: unknown) => apiRequest(home, "PATCH", path, body);

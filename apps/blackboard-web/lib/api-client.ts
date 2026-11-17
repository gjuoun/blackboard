import { Safe } from "@gjuoun/safe-ts";
import { apiOrigin, apiUrl } from "./api-origin";

/** No API URL for this home: nothing answers for it, so nothing was written. */
export type ApiUnreachable = { readonly ApiUnreachable: { readonly message: string } };

/** The API answered with an error: the write did not happen, and the message is the reason. */
export type ApiRefused = { readonly ApiRefused: { readonly message: string } };

export type ApiFailure = ApiUnreachable | ApiRefused;

const unreachable = (message: string): ApiUnreachable => ({ ApiUnreachable: { message } });
const refused = (message: string): ApiRefused => ({ ApiRefused: { message } });

const NOT_RUNNING = "the API is not running — start it with: blackboard serve start";

/**
 * The reason a refused call carries. Two shapes reach here: the old `{error:"…"}` text and the
 * envelope's `{success:false,error:{code,message}}`, because routes move over one at a time.
 */
const messageOf = (data: unknown, fallback: string): string => {
  const e = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  if (typeof e === "string") return e;
  const message = e && typeof e === "object" ? (e as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : fallback;
};

/** One request to the API for this home. A connection failure is ApiUnreachable; an HTTP error is ApiRefused. */
export function apiRequest(
  home: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Safe<unknown, ApiFailure> {
  return Safe.try(function* () {
    const base = apiUrl(home);
    if (!base) return (yield Safe.err(unreachable(NOT_RUNNING))) as never;
    const res = (yield Safe.call(
      async () =>
        await fetch(`${base}${path}`, {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        }),
      () => unreachable(`${NOT_RUNNING} (${base})`),
    )) as Response;
    const text = (yield Safe.call(
      async () => await res.text(),
      () => unreachable(`${NOT_RUNNING} (${base})`),
    )) as string;
    const data = (yield Safe.call(
      () => (text === "" ? null : (JSON.parse(text) as unknown)),
      () => refused(text || res.statusText),
    )) as unknown;
    if (!res.ok) return (yield Safe.err(refused(messageOf(data, res.statusText)))) as never;
    return data;
  }) as unknown as Safe<unknown, ApiFailure>;
}

export const apiGet = (home: string, path: string) => apiRequest(home, "GET", path);
export const apiPost = (home: string, path: string, body: unknown) => apiRequest(home, "POST", path, body);
export const apiPatch = (home: string, path: string, body: unknown) => apiRequest(home, "PATCH", path, body);

/** A GET from the API for a server component. A failed call throws, so the page shows its error boundary. */
export async function apiGetJson<T>(home: string, path: string): Promise<T> {
  const res = await fetch(`${apiOrigin(home)}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(messageOf(body, `API ${path} answered ${res.status}`));
  }
  return (await res.json()) as T;
}

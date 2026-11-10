import { apiOrigin } from "./api-origin";

/**
 * A GET from the API for a server component. A failed call throws, so the page shows its error
 * boundary instead of an empty list that looks like a real answer.
 */
export async function apiGetJson<T>(home: string, path: string): Promise<T> {
  const res = await fetch(`${apiOrigin(home)}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `API ${path} answered ${res.status}`);
  }
  return (await res.json()) as T;
}

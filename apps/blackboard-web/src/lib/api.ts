import { createServerFn } from "@tanstack/react-start";
import { apiGetJson } from "@/lib/api-client";
import { getHome } from "@/lib/home";
import type { WorkspaceData } from "@/lib/reading-model";

/**
 * The server-only half of every page: where the board lives, and the API call that reads it.
 * A route's loader calls one of these; loaders are isomorphic, so anything touching the disk or
 * `apiOrigin` has to sit behind a server function or it rides into the browser bundle.
 */

/** The inbox and its settings read the same assembly, so the repo list can only offer real names. */
export const loadWorkspace = createServerFn({ method: "GET" }).handler(
  async (): Promise<WorkspaceData> => apiGetJson<WorkspaceData>(getHome(), "/api/workspace"),
);

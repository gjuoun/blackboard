import { createFileRoute } from "@tanstack/react-router";
import { forward } from "~/lib/forward";

/**
 * Every `/api/*` request the UI answers. Two shapes:
 *
 * - **Dev** (`vite dev`): `BLACKBOARD_API_URL` names the API process run beside it (see README),
 *   so the splat forwards there — Vite's SSR runner cannot load `bun:sqlite`, so the Hono app
 *   cannot mount here.
 * - **Prod** (`bun .output/server/index.mjs`): no API URL — the artifact is one process, so the
 *   splat mounts the Hono app directly and the API answers in-process.
 */
const api = process.env.BLACKBOARD_API_URL;

const handle = ({ request }: { request: Request }) =>
  api
    ? forward(request)
    : import("@/api/app").then(({ app }) => app.fetch(request));

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle } },
});
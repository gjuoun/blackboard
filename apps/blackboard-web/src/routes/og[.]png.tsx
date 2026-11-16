import { createFileRoute } from "@tanstack/react-router";
import { ogCard, OG_TYPE } from "~/lib/og";

/** The site-wide share card. A server route replaces Next's `opengraph-image.tsx` convention. */
export const Route = createFileRoute("/og.png")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await ogCard({ title: "Review plans with your coding agent", line: "A local markdown reviewer with comments on the text." }), {
          headers: { "content-type": OG_TYPE, "cache-control": "public, max-age=3600" },
        }),
    },
  },
});
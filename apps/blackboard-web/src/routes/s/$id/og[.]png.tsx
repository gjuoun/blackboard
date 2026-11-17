import { basename } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { drawable, OG_TYPE, ogCard } from "~/lib/og";
import { loadSessionPage } from "~/lib/session";

/** Share card for one doc: its title, or the file name when the title has characters the card cannot draw. */
export const Route = createFileRoute("/s/$id/og.png")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).pathname.split("/")[2] ?? "";
        const page = await loadSessionPage({ data: { id } }).catch(() => null);
        if (!page) {
          return new Response(
            await ogCard({ title: "Blackboard", line: "Review markdown with your coding agent." }),
            { headers: { "content-type": OG_TYPE } },
          );
        }
        const { header } = page;
        const file = basename(header.path);
        const title = drawable(header.title) ? header.title : drawable(file) ? file : "Document";
        const png = await ogCard({
          title,
          line: `${header.sections} sections · ${header.diagrams} diagrams · ${header.open} open comments`,
        });
        return new Response(png, {
          headers: { "content-type": OG_TYPE, "cache-control": "public, max-age=60" },
        });
      },
    },
  },
});

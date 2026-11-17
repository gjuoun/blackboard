import { createFileRoute } from "@tanstack/react-router";
import { ReadingWorkspace } from "@/components/ReadingWorkspace";
import { loadWorkspace } from "~/lib/api";

/** The inbox: every served document with its persisted reading state. */
export const Route = createFileRoute("/inbox/")({
  loader: () => loadWorkspace(),
  // Next's title template appended " · Blackboard"; TanStack has no template, so the route spells it.
  head: () => ({ meta: [{ title: "Inbox · Blackboard" }] }),
  component: Inbox,
});

function Inbox() {
  return <ReadingWorkspace initial={Route.useLoaderData()} />;
}

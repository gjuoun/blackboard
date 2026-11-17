import { createFileRoute, Link } from "@tanstack/react-router";
import { WorkspaceSettings } from "@/components/WorkspaceSettings";
import { loadWorkspace } from "~/lib/api";
import pkg from "../../../package.json";

/**
 * The global settings page: the fifth tab on a phone, the gear's target on desktop. The repo list
 * comes from the same workspace assembly the inbox uses, so the Default repo row only ever offers
 * real names.
 */
export const Route = createFileRoute("/inbox/settings")({
  loader: () => loadWorkspace(),
  head: () => ({ meta: [{ title: "Workspace settings · Blackboard" }] }),
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  const data = Route.useLoaderData();
  return (
    <div className="mx-auto min-h-[calc(100dvh-var(--bar-h))] max-w-[560px] pb-8">
      <div className="flex h-[52px] items-center gap-2 px-3.5">
        <Link
          to="/inbox"
          aria-label="Back to the inbox"
          title="Back"
          className="text-muted-foreground hover:bg-accent hover:text-foreground grid size-[34px] place-items-center rounded-[9px] pb-1 text-[22px] md:hidden"
        >
          ‹
        </Link>
        <Link to="/inbox" className="flex items-center gap-2 text-[15px] font-bold">
          <span className="bg-primary size-2.5 rotate-45 rounded-[2px]" aria-hidden />
          Settings
        </Link>
        <span className="flex-1" />
        <span className="text-muted-foreground font-mono text-[10.5px]">Global</span>
      </div>
      <WorkspaceSettings repos={data.repos} version={pkg.version} />
    </div>
  );
}

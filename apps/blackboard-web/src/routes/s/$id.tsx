import { Badge } from "@gjuoun/bb-ui/components/ui/badge";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Folder, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";
import { DocChip } from "@/components/DocChip";
import { DocView } from "@/components/DocView";
import { useNav } from "@/components/nav";
import { Toc } from "@/components/Toc";
import { loadSessionPage, type SessionHeader } from "~/lib/session";

export const Route = createFileRoute("/s/$id")({
  loader: async ({ params }) => {
    const page = await loadSessionPage({ data: { id: params.id } });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "No such session · Blackboard" }] };
    const { header } = loaderData;
    const where = header.path.split("/").pop() ?? header.path;
    const description = `${where} on Blackboard: ${header.sections} sections, ${header.open} open comments.`;
    return {
      meta: [
        // Next's title template appended " · Blackboard"; the route spells it out here.
        { title: `${header.title} · Blackboard` },
        { name: "description", content: description },
        { property: "og:title", content: header.title },
        { property: "og:description", content: description },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: header.title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  notFoundComponent: SessionNotFound,
  component: SessionPage,
});

/** The chips above the body: where the file is, which project, which branch, which worktree. */
function Header({ header }: { header: SessionHeader }) {
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5 text-xs" data-testid="doc-head">
      <DocChip
        testid="doc-location"
        title={header.path}
        className="flex w-full min-w-0"
        copy={{ value: header.path, label: "Copy path" }}
      >
        <Folder aria-hidden />
        <span dir="rtl" className="min-w-0 flex-1 truncate text-left">
          <bdi dir="ltr">{header.location}</bdi>
        </span>
      </DocChip>
      <div
        className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="doc-meta-row"
      >
        <DocChip
          testid="doc-project"
          title={`project root ${header.projectRoot}`}
          className="shrink-0"
          copy={{ value: header.projectRoot, label: "Copy project path" }}
        >
          <FolderTree aria-hidden />
          <span className="min-w-0 truncate">{header.projectName}</span>
        </DocChip>
        {header.branch ? (
          <DocChip
            testid="doc-branch"
            title={header.detached ? "detached HEAD" : "git branch"}
            tone={header.detached ? "muted" : "default"}
            className="shrink-0"
            copy={
              header.detached
                ? { value: header.branch, label: "Copy short sha" }
                : { value: header.branch, label: "Copy branch" }
            }
          >
            {header.detached ? <GitCommitHorizontal aria-hidden /> : <GitBranch aria-hidden />}
            <span className="min-w-0 truncate">{header.branch}</span>
          </DocChip>
        ) : null}
        {header.worktreePath && header.worktreeName ? (
          <DocChip
            testid="doc-worktree"
            title={`git worktree at ${header.worktreePath}`}
            tone="accent"
            className="shrink-0"
            copy={{ value: header.worktreePath, label: "Copy worktree path" }}
          >
            <FolderGit2 aria-hidden />
            <span className="min-w-0 truncate">{header.worktreeName}</span>
          </DocChip>
        ) : null}
        {header.missing ? (
          <Badge variant="destructive" className="h-6 shrink-0 rounded-md px-2 py-0 font-normal">
            missing
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function SessionPage() {
  const page = Route.useLoaderData();
  const { header } = page;

  if (page.kind === "missing-file") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 md:px-6" data-testid="doc-missing">
        <Header header={header} />
        <h1 className="text-2xl font-bold">{header.title}</h1>
        <p className="text-muted-foreground mt-3">
          This file is missing or no longer a markdown file:{" "}
          <code className="bg-code rounded px-1.5">{page.sessionPath}</code>
        </p>
        <p className="text-muted-foreground mt-2">
          Open its new location with{" "}
          <code className="bg-code rounded px-1.5">blackboard open &lt;file&gt;</code>.
        </p>
      </main>
    );
  }

  return (
    <DocView
      key={header.id}
      session={header.id}
      title={header.title}
      path={page.sessionPath}
      html={page.html}
      initialComments={page.comments}
      header={<Header header={header} />}
      toc={page.toc.length > 1 ? <Toc toc={page.toc} /> : null}
    />
  );
}

/** The session is gone: offer the way back in. */
function SessionNotFound() {
  const { Link } = useNav();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-6" data-testid="session-not-found">
      <h1 className="text-2xl font-bold">No such session</h1>
      <p className="text-muted-foreground mt-3">
        It was closed or never opened. Open a file with{" "}
        <code className="bg-code rounded px-1.5">blackboard open &lt;file&gt;</code>, or go{" "}
        <Link href="/inbox" className="text-primary hover:underline">
          Inbox
        </Link>
        .
      </p>
    </main>
  );
}

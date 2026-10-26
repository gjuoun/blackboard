import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Folder, FolderGit2, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DocView } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { readComments } from "@/lib/comments-store";
import { getHome } from "@/lib/home";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { getSession, SCRATCHPAD_ID, scratchpadSession, servablePath, sessionCommentsPath, sessionRow, tildify } from "@/lib/sessions";

/** The tab title is the doc's own title; the description names the file, never its folder. */
export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const home = getHome();
  if (id === SCRATCHPAD_ID) scratchpadSession(home);
  const session = getSession(home, id);
  if (!session) return { title: "No such session" };
  const row = sessionRow(home, session);
  const description = `${basename(session.path)} on Blackboard: ${row.stats.sections} sections, ${row.open} open comments.`;
  return { title: row.title, description, openGraph: { title: row.title, description }, twitter: { card: "summary_large_image", title: row.title, description } };
}

/** One session: a registered markdown file, its comments, where it lives and which branch. */
export default async function SessionPage({ params }: PageProps<"/s/[id]">) {
  await connection();
  const { id } = await params;
  const home = getHome();
  if (id === SCRATCHPAD_ID) scratchpadSession(home);
  const session = getSession(home, id);
  if (!session) notFound();
  const row = sessionRow(home, session);
  const file = servablePath(session);

  // Where the file lives, which branch, and which linked worktree: chips above the doc.
  // Chips share one height, radius and padding; the location chip alone takes the slack and truncates from the left.
  const chip = "h-6 max-w-full min-w-0 rounded-md border-border bg-card px-2 py-0 font-mono font-normal";
  const header = (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2 text-xs md:flex-nowrap" data-testid="doc-head">
      <Badge variant="outline" className={cn(chip, "shrink")} data-testid="doc-location" title={row.path}>
        <Folder aria-hidden />
        <span dir="rtl" className="min-w-0 truncate">
          <bdi dir="ltr">{tildify(row.path)}</bdi>
        </span>
      </Badge>
      {row.branch ? (
        <Badge
          variant="outline"
          className={cn(chip, "shrink-0", row.detached && "text-muted-foreground")}
          data-testid="doc-branch"
          title={row.detached ? "detached HEAD" : "git branch"}
        >
          {row.detached ? <GitCommitHorizontal aria-hidden /> : <GitBranch aria-hidden />}
          <span className="min-w-0 truncate">{row.branch}</span>
        </Badge>
      ) : null}
      {row.worktree ? (
        <Badge
          variant="outline"
          className={cn(chip, "shrink-0 border-primary/50 bg-primary-soft text-foreground [&>svg]:text-primary")}
          data-testid="doc-worktree"
          title={`git worktree at ${row.worktree.path}`}
        >
          <FolderGit2 aria-hidden />
          <span className="min-w-0 truncate">{row.worktree.name}</span>
        </Badge>
      ) : null}
      {row.missing ? <Badge variant="destructive" className="h-6 rounded-md px-2 py-0 font-normal">missing</Badge> : null}
    </div>
  );

  if (!file) {
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable={false} hasToc={false} />
        <main className="mx-auto max-w-2xl px-4 py-10 md:px-6" data-testid="doc-missing">
          {header}
          <h1 className="text-2xl font-bold">{row.title}</h1>
          <p className="text-muted-foreground mt-3">
            This file is missing or no longer a markdown file: <code className="bg-code rounded px-1.5">{session.path}</code>
          </p>
          <p className="text-muted-foreground mt-2">
            Open its new location with <code className="bg-code rounded px-1.5">blackboard open &lt;file&gt;</code>.
          </p>
        </main>
      </>
    );
  }

  const { html, toc } = await renderMarkdown(readFileSync(file, "utf8"), { assetBase: `/api/asset/${id}` });
  const doc = basename(file);
  return (
    <>
      <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={toc.length > 1} />
      <DocView
        key={session.id}
        session={session.id}
        title={row.title}
        path={session.path}
        html={html}
        initialComments={readComments(sessionCommentsPath(home, session.id)).docs[doc] ?? []}
        header={header}
        toc={toc.length > 1 ? <Toc toc={toc} /> : null}
      />
    </>
  );
}

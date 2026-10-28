import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Folder, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DiffPanel } from "@/components/DiffPanel";
import { DocChip } from "@/components/DocChip";
import { DocView } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { renderComments } from "@/lib/comment-markdown";
import { readComments } from "@/lib/comments-store";
import { getDiffSnapshot } from "@/lib/diff-index";
import { fileHref, parseSelectedFile, tabHref } from "@/lib/file-refs";
import { getHome } from "@/lib/home";
import { renderMarkdown } from "@/lib/markdown";
import { parseRightTab } from "@/lib/prefs";
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
export default async function SessionPage({ params, searchParams }: PageProps<"/s/[id]">) {
  await connection();
  const { id } = await params;
  const search = await searchParams;
  const home = getHome();
  if (id === SCRATCHPAD_ID) scratchpadSession(home);
  const session = getSession(home, id);
  if (!session) notFound();
  const row = sessionRow(home, session);
  const file = servablePath(session);

  // Two rows, on every width. Row 1: the file's full path. Row 2: its project, branch and linked worktree,
  // always one line: on a narrow screen that line scrolls sideways (scrollbar hidden) instead of wrapping.
  // Each chip keeps its own copy button: path, project root, branch (or short sha) and worktree path.
  const project = row.project ?? { name: basename(dirname(row.path)), root: dirname(row.path) };
  const header = (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5 text-xs" data-testid="doc-head">
      <DocChip testid="doc-location" title={row.path} className="flex w-full min-w-0" copy={{ value: row.path, label: "Copy path" }}>
        <Folder aria-hidden />
        <span dir="rtl" className="min-w-0 flex-1 truncate text-left">
          <bdi dir="ltr">{tildify(row.path)}</bdi>
        </span>
      </DocChip>
      <div
        className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="doc-meta-row"
      >
        <DocChip testid="doc-project" title={`project root ${project.root}`} className="shrink-0" copy={{ value: project.root, label: "Copy project path" }}>
          <FolderTree aria-hidden />
          <span className="min-w-0 truncate">{project.name}</span>
        </DocChip>
        {row.branch ? (
          <DocChip
            testid="doc-branch"
            title={row.detached ? "detached HEAD" : "git branch"}
            tone={row.detached ? "muted" : "default"}
            className="shrink-0"
            copy={row.detached ? { value: row.branch, label: "Copy short sha" } : { value: row.branch, label: "Copy branch" }}
          >
            {row.detached ? <GitCommitHorizontal aria-hidden /> : <GitBranch aria-hidden />}
            <span className="min-w-0 truncate">{row.branch}</span>
          </DocChip>
        ) : null}
        {row.worktree ? (
          <DocChip
            testid="doc-worktree"
            title={`git worktree at ${row.worktree.path}`}
            tone="accent"
            className="shrink-0"
            copy={{ value: row.worktree.path, label: "Copy worktree path" }}
          >
            <FolderGit2 aria-hidden />
            <span className="min-w-0 truncate">{row.worktree.name}</span>
          </DocChip>
        ) : null}
        {row.missing ? <Badge variant="destructive" className="h-6 shrink-0 rounded-md px-2 py-0 font-normal">missing</Badge> : null}
      </div>
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

  // One snapshot for the whole request: the link visitor and the diff pane read this index, never
  // the filesystem or git.
  const docPath = row.repo?.relPath ?? null;
  const snapshot = row.repo ? getDiffSnapshot(row.repo.root) : null;
  const selected = snapshot ? parseSelectedFile(search, docPath) : null;
  const rightTab = snapshot && parseRightTab(search.tab) === "pr" ? "pr" : "comments";
  const prHref = selected
    ? fileHref(selected.path, selected.start !== null ? { start: selected.start, end: selected.end ?? selected.start } : null)
    : tabHref("pr");
  const { html, toc } = await renderMarkdown(readFileSync(file, "utf8"), {
    assetBase: `/api/asset/${id}`,
    fileLinks: snapshot ? { index: snapshot, docPath, selected } : undefined,
  });
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
        initialComments={renderComments(readComments(sessionCommentsPath(home, session.id)).docs[doc] ?? [])}
        header={header}
        toc={toc.length > 1 ? <Toc toc={toc} /> : null}
        rightTab={rightTab}
        diff={
          snapshot
            ? {
                panel: <DiffPanel index={snapshot} selected={selected} />,
                commentHref: tabHref("comments"),
                prHref,
                additions: snapshot.totals.additions,
                deletions: snapshot.totals.deletions,
              }
            : undefined
        }
      />
    </>
  );
}

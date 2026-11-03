import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Folder, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DocChip } from "@/components/DocChip";
import { DocView, type FileRail } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { renderComments } from "@/lib/comment-markdown";
import { readComments } from "@/lib/comments-store";
import { getHome } from "@/lib/home";
import { renderCode } from "@/lib/code-view";
import { docType, type DocType } from "@/lib/doc-type";
import { LEFT_TABS_BY_TYPE, parseLeftTab, type LeftTab } from "@/lib/left-rail";
import { LeftRail } from "@/components/LeftRail";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { FileView } from "@/components/FileView";
import { changedAgainstHead } from "@/lib/file-source";
import type { WorkspacePane } from "@/lib/workspace-pane";
import { renderMarkdown } from "@/lib/markdown";
import { parseRightTab } from "@/lib/prefs";
import { servablePath, sessionCommentsPath, tildify } from "@/lib/sessions";
import { loadSession as load, loadWorkspacePane } from "@/lib/session-view";

/**
 * The left rail for a type: its tab strip and the pane under the active tab. Tabs are links
 * (`?left=`), so the rail needs no client state. Only 内容 has a pane in this step; the others are
 * filled in by later steps and show a short placeholder until then.
 */


/** The File rail for every document with source. `view=full` opens the full-window reader. */
function fileRailFor(id: string, file: string, row: { repo: { root: string } | null }, view: string | string[] | undefined): FileRail {
  const full = view === "full";
  return { panel: filePane(id, file, row, full), href: `/s/${id}?tab=file`, commentHref: `/s/${id}?tab=comments` };
}

/** The File tab's pane: the raw source with lines that differ from HEAD marked. Reads the file once. */
function filePane(id: string, file: string, row: { repo: { root: string } | null }, full: boolean) {
  const src = readFileSync(file, "utf8");
  const lines = src.replace(/\n$/, "").split("\n");
  const changed = changedAgainstHead(row.repo?.root ?? null, file, lines.length);
  return <FileView lines={lines} changed={changed} full={full} backHref={`/s/${id}?tab=file`} fullHref={`/s/${id}?tab=file&view=full`} />;
}

function leftPane(
  id: string,
  type: DocType,
  requested: string | string[] | undefined,
  toc: React.ReactNode,
  workspace: WorkspacePane,
): React.ReactNode {
  const tabs = LEFT_TABS_BY_TYPE[type];
  const active: LeftTab = parseLeftTab(typeof requested === "string" ? requested : undefined, type);
  let pane: React.ReactNode;
  if (active === "contents") pane = toc;
  else {
    pane = workspace.state === "outside-git" ? (
      <p className="text-muted-foreground p-3 text-[13px]">不在 git 仓库中</p>
    ) : (
      <div className="p-3"><WorkspaceTree nodes={workspace.tree} current={workspace.current} sessionByPath={workspace.sessionByPath} /></div>
    );
  }
  return (
    <>
      <LeftRail tabs={tabs} active={active} hrefFor={(t) => `/s/${id}?left=${t}`} />
      {pane}
    </>
  );
}

/** The tab title is the doc's own title; the description names the file, never its folder. */
export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const home = getHome();
  const found = await load(home, id);
  if (!found) return { title: "No such session" };
  const { session, row } = found;
  const title = row.title;
  const description = `${basename(session.path)} on Blackboard: ${row.stats.sections} sections, ${row.open} open comments.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

/** One session: a registered markdown file, its comments, where it lives and which branch. */
export default async function SessionPage({ params, searchParams }: PageProps<"/s/[id]">) {
  await connection();
  const { id } = await params;
  const search = await searchParams;
  const home = getHome();
  const found = await load(home, id);
  if (!found) notFound();
  const { session, row } = found;
  // A registry from the streaming era may still hold kind: "stream" entries. Such a session is
  // not openable: it answers this page's not-found surface instead of throwing.
  if (session.kind === "stream") notFound();
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

  // A source file is its own page: the text is shown as one highlighted block, with no front matter,
  // no TOC and no file links.
  const type = docType(file);
  if (type.ok && type.type === "code") {
    const src = readFileSync(file, "utf8");
    const { html } = await renderCode(src, file);
    // Comments on a source file anchor to its text like a doc's do, so they are read the same way.
    const codeComments = renderComments(readComments(sessionCommentsPath(home, session.id)).docs[basename(file)] ?? []);
    const left = leftPane(id, "code", search.left, null, await loadWorkspacePane(row.repo?.root ?? null, row.repo?.relPath ?? null, home));
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={false} />
        <DocView key={session.id} session={session.id} title={row.title} path={session.path} html={html} initialComments={codeComments} header={header} toc={left} rightTab={parseRightTab(search.tab)} fileRail={fileRailFor(id, file, row, search.view)} />
      </>
    );
  }
  // The doc is read once: the same string feeds the markdown pass and the comments pane.
  const src = readFileSync(file, "utf8");
  const { html, toc } = await renderMarkdown(src, { assetBase: `/api/asset/${id}` });
  const doc = basename(file);
  const commentFile = readComments(sessionCommentsPath(home, session.id));
  const renderedComments = renderComments(commentFile.docs[doc] ?? []);
  const reviews = (commentFile.reviews ?? []).filter((r) => r.doc === doc);
  return (
    <>
      <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={toc.length > 1} />
      <DocView
        key={session.id}
        session={session.id}
        title={row.title}
        path={session.path}
        html={html}
        initialComments={renderedComments}
        reviews={reviews}
        header={header}
        toc={leftPane(id, "doc", search.left, toc.length > 1 ? <Toc toc={toc} /> : null, await loadWorkspacePane(row.repo?.root ?? null, row.repo?.relPath ?? null, home))}
        rightTab={parseRightTab(search.tab)}
        fileRail={fileRailFor(id, file, row, search.view)}
      />
    </>
  );
}

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Folder, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DiffPanel } from "@/components/DiffPanel";
import { DocChip } from "@/components/DocChip";
import { DocView, type FileRail } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { groupCodeThreads } from "@/lib/code-anchor";
import { renderComments } from "@/lib/comment-markdown";
import { readComments } from "@/lib/comments-store";
import { getDiffSnapshot } from "@/lib/diff-index";
import { LOCAL_PR } from "@/lib/features";
import { fileHref, parseSelectedFile, parseShowAll, tabHref } from "@/lib/file-refs";
import { getHome } from "@/lib/home";
import { renderCode } from "@/lib/code-view";
import { docType, type DocType } from "@/lib/doc-type";
import { LEFT_TABS_BY_TYPE, parseLeftTab, type LeftTab } from "@/lib/left-rail";
import { LeftRail } from "@/components/LeftRail";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { StreamTimeline } from "@/components/StreamTimeline";
import { FileView } from "@/components/FileView";
import { changedAgainstHead } from "@/lib/file-source";
import { parseStream, type StreamBlock } from "@/lib/stream-doc";
import { renderStream } from "@/lib/stream-html";
import { workspacePane, type WorkspacePane } from "@/lib/workspace-pane";
import { renderMarkdown } from "@/lib/markdown";
import { parsePrFrontmatter } from "@/lib/pr-kind";
import { parseRightTab, type RightTab } from "@/lib/prefs";
import { getSession, listSessions, SCRATCHPAD_ID, scratchpadSession, servablePath, sessionCommentsPath, sessionRow, tildify } from "@/lib/sessions";

/**
 * The left rail for a type: its tab strip and the pane under the active tab. Tabs are links
 * (`?left=`), so the rail needs no client state. Only 内容 has a pane in this step; the others are
 * filled in by later steps and show a short placeholder until then.
 */
/** The stream the top-bar timeline button opens: the most recently opened stream session, or null. */
function streamHrefFor(home: string): string | null {
  const s = listSessions(home).filter((x) => x.kind === "stream").sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
  return s ? `/s/${s.id}` : null;
}

/** The `tab` query selects the right pane; anything but `file` and `pr` is the comments pane. */
function rightOf(tab: string | string[] | undefined): RightTab {
  return tab === "file" ? "file" : tab === "pr" ? "pr" : "comments";
}

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

function leftPane(id: string, type: DocType, requested: string | string[] | undefined, toc: React.ReactNode, workspace: WorkspacePane, blocks: readonly StreamBlock[] = []): React.ReactNode {
  const tabs = LEFT_TABS_BY_TYPE[type];
  const active: LeftTab = parseLeftTab(typeof requested === "string" ? requested : undefined, type);
  let pane: React.ReactNode;
  if (active === "contents") pane = toc;
  else if (active === "workspace") {
    pane = workspace.state === "outside-git" ? (
      <p className="text-muted-foreground p-3 text-[13px]">不在 git 仓库中</p>
    ) : (
      <div className="p-3"><WorkspaceTree nodes={workspace.tree} current={workspace.current} sessionByPath={workspace.sessionByPath} /></div>
    );
  } else pane = <StreamTimeline blocks={blocks} />;
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
        <RegisterTab id={session.id} title={row.title} path={session.path} readable={false} hasToc={false} streamHref={streamHrefFor(home)} />
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
  // no TOC and no file links. A stream is shown by its own renderer (step 6); until then it is a placeholder.
  const type = docType(file, session.kind ?? "plain");
  if (type.ok && type.type === "code") {
    const src = readFileSync(file, "utf8");
    const { html } = await renderCode(src, file);
    // Comments on a source file anchor to its text like a doc's do, so they are read the same way.
    const codeComments = renderComments(readComments(sessionCommentsPath(home, session.id)).docs[basename(file)] ?? []);
    const left = leftPane(id, "code", search.left, null, workspacePane(row.repo?.root ?? null, row.repo?.relPath ?? null, home));
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={false} kind="code" streamHref={streamHrefFor(home)} />
        <DocView key={session.id} session={session.id} title={row.title} path={session.path} html={html} initialComments={codeComments} header={header} toc={left} rightTab={rightOf(search.tab)} fileRail={fileRailFor(id, file, row, search.view)} />
      </>
    );
  }
  if (type.ok && type.type === "stream") {
    // One read of the file, then one render per block. The composer is not part of the body: writing
    // happens in the comments rail, so the body ends at its last block.
    const blocks = parseStream(readFileSync(file, "utf8")).blocks;
    const streamHtml = await renderStream(blocks);
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable={false} hasToc={false} kind="stream" streamHref={`/s/${session.id}`} />
        <DocView key={session.id} session={session.id} title={row.title} path={session.path} html={streamHtml} initialComments={renderComments(readComments(sessionCommentsPath(home, session.id)).docs[basename(file)] ?? [])} header={header} toc={leftPane(id, "stream", search.left, null, { state: "outside-git" }, blocks)} rightTab={rightOf(search.tab)} fileRail={fileRailFor(id, file, row, search.view)} />
      </>
    );
  }
  // The doc is read once: its front matter decides the rail and the pinned diff base, and the same
  // string feeds the markdown pass that collects this document's file links.
  const src = readFileSync(file, "utf8");
  const prDoc = parsePrFrontmatter(src);
  // Explicit, checkable activation: the session says pr and the doc carries a pin git can read.
  // LOCAL_PR is off (see lib/features.ts): the pin diffs the DOC's repo, not the code repo a plan
  // wants to read, so the whole rail + `file:` links stay dormant until the base can name one.
  const pr = LOCAL_PR && session.kind === "pr" && prDoc.baseSha !== null;
  // One snapshot for the whole request: the link visitor and the diff pane read this index, never
  // the filesystem or git. A pr doc pins the commit its front matter names; a plain doc keeps the
  // floating base only for its code-comment threads and never shows the diff.
  const docPath = row.repo?.relPath ?? null;
  const snapshot = row.repo ? getDiffSnapshot(row.repo.root, pr ? { baseRef: prDoc.base ?? "main", base: prDoc.baseSha! } : {}) : null;
  const selected = snapshot ? parseSelectedFile(search, docPath) : null;
  const rightTab: RightTab = pr && snapshot && parseRightTab(search.tab) === "pr" ? "pr" : rightOf(search.tab) === "file" ? "file" : "comments";
  const prHref = selected
    ? fileHref(selected.path, selected.start !== null ? { start: selected.start, end: selected.end ?? selected.start } : null)
    : tabHref("pr");
  // A plain document's file: links stay literal text, so the visitor is not installed for it.
  const { html, toc, fileRefs } = await renderMarkdown(src, {
    assetBase: `/api/asset/${id}`,
    fileLinks: pr && snapshot ? { index: snapshot, docPath, selected } : undefined,
  });
  const showAll = parseShowAll(search.all);
  const doc = basename(file);
  // One render of the stored comments feeds both panes: the list the client keeps, and the threads
  // the diff box prints. The grouping resolves each code anchor against the same request snapshot.
  const commentFile = readComments(sessionCommentsPath(home, session.id));
  const renderedComments = renderComments(commentFile.docs[doc] ?? []);
  const reviews = (commentFile.reviews ?? []).filter((r) => r.doc === doc);
  const codeThreads = groupCodeThreads(renderedComments, snapshot);
  return (
    <>
      <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={toc.length > 1} streamHref={streamHrefFor(home)} />
      <DocView
        key={session.id}
        session={session.id}
        title={row.title}
        path={session.path}
        html={html}
        initialComments={renderedComments}
        reviews={reviews}
        header={header}
        toc={leftPane(id, "doc", search.left, toc.length > 1 ? <Toc toc={toc} /> : null, workspacePane(row.repo?.root ?? null, row.repo?.relPath ?? null, home))}
        rightTab={rightTab}
        fileRail={fileRailFor(id, file, row, search.view)}
        codeState={codeThreads.state}
        diff={
          snapshot
            ? {
                panel: pr ? <DiffPanel index={snapshot} selected={selected} refs={fileRefs} showAll={showAll} threads={codeThreads.byRow} session={session.id} /> : null,
                commentHref: tabHref("comments"),
                prHref,
                additions: snapshot.totals.additions,
                deletions: snapshot.totals.deletions,
                showPr: pr,
              }
            : undefined
        }
      />
    </>
  );
}

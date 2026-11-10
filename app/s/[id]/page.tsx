import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Folder, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DocChip } from "@/components/DocChip";
import { DocView } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { renderComments } from "@/lib/comment-markdown";

import { getHome } from "@/lib/home";
import { renderCode } from "@/lib/code-view";
import { docType } from "@/lib/doc-type";
import { renderMarkdown } from "@/lib/markdown";
import { servablePath, tildify } from "@/lib/sessions";
import { loadComments, loadSession as load } from "@/lib/session-view";

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
export default async function SessionPage({ params }: PageProps<"/s/[id]">) {
  await connection();
  const { id } = await params;
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
    const codeComments = renderComments((await loadComments(home, session.id)).docs[basename(file)] ?? []);
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={false} />
        <DocView key={session.id} session={session.id} title={row.title} path={session.path} html={html} initialComments={codeComments} header={header} toc={null} />
      </>
    );
  }
  // The doc is read once: the same string feeds the markdown pass and the comments pane.
  const src = readFileSync(file, "utf8");
  const { html, toc } = await renderMarkdown(src, { assetBase: `/api/asset/${id}` });
  const doc = basename(file);
  const commentFile = await loadComments(home, session.id);
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
        toc={toc.length > 1 ? <Toc toc={toc} /> : null}

      />
    </>
  );
}

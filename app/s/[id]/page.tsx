import { basename, dirname } from "node:path";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Folder, FolderGit2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DocChip } from "@/components/DocChip";
import { DocView } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { renderCode } from "@/lib/code-view";
import { docType } from "@/lib/doc-type";
import { getHome } from "@/lib/home";
import { renderMarkdown } from "@/lib/markdown";
import { docKey, servablePath, tildify } from "@/lib/session-model";
import { tocFromBlocks } from "@/lib/stream-doc";
import { DEFAULT_VIEWPORT_H, PENDING_META_BAND, planStreamWindow } from "@/lib/stream-window";
import { StreamBody } from "@/components/StreamBody";
import { relativeTime } from "@/lib/relative-time";
import { loadSession as load } from "@/lib/session-view";

/** The tab title is the doc's own title; the description names the file, never its folder. */
export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const found = await load(getHome(), id);
  if (!found) return { title: "No such session" };
  const { session, row } = found;
  const title = row.title;
  const where = session.kind === "stream" ? session.id : basename(session.path);
  const description = `${where} on Blackboard: ${row.stats.sections} sections, ${row.open} open comments.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

/** One session: a registered markdown file, its comments, where it lives and which branch. */
export default async function SessionPage({ params, searchParams }: PageProps<"/s/[id]">) {
  await connection();
  const { id } = await params;
  const query = await searchParams;
  const found = await load(getHome(), id);
  if (!found) notFound();
  const { session, row } = found;
  // A streamed doc has no file: its body is the folded block list, which the doc branch renders.
  const stream = session.kind === "stream";
  const file = servablePath(session);

  // Two rows, on every width. Row 1: the file's full path. Row 2: its project, branch and linked worktree,
  // always one line: on a narrow screen that line scrolls sideways (scrollbar hidden) instead of wrapping.
  // Each chip keeps its own copy button: path, project root, branch (or short sha) and worktree path.
  const project = row.project ?? { name: stream ? "stream" : basename(dirname(row.path)), root: stream ? "" : dirname(row.path) };
  const header = (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5 text-xs" data-testid="doc-head">
      <DocChip testid="doc-location" title={stream ? `streamed document ${session.id}` : row.path} className="flex w-full min-w-0" copy={stream ? { value: session.id, label: "Copy session id" } : { value: row.path, label: "Copy path" }}>
        <Folder aria-hidden />
        <span dir="rtl" className="min-w-0 flex-1 truncate text-left">
          <bdi dir="ltr">{stream ? `stream · ${session.id}` : tildify(row.path)}</bdi>
        </span>
      </DocChip>
      <div
        className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="doc-meta-row"
      >
        {!stream ? (
          <DocChip testid="doc-project" title={`project root ${project.root}`} className="shrink-0" copy={{ value: project.root, label: "Copy project path" }}>
            <FolderTree aria-hidden />
            <span className="min-w-0 truncate">{project.name}</span>
          </DocChip>
        ) : null}
        {!stream && row.branch ? (
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
        {!stream && row.worktree ? (
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

  if (!file && !stream) {
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
  // no TOC and no file links. Comments on it anchor to its text like a doc's do. A streamed doc has
  // no file at all — it falls through to the markdown branch below.
  const type = stream ? null : docType(file!);
  if (type && type.ok && type.type === "code") {
    const src = found.body ?? "";
    const { html } = await renderCode(src, file!);
    const codeComments = found.comments.docs[basename(file!)] ?? [];
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={false} />
        <DocView key={session.id} session={session.id} title={row.title} path={session.path} html={html} initialComments={codeComments} header={header} toc={null} />
      </>
    );
  }
  const doc = docKey(session);
  // A streamed doc renders its exchanges as a timeline: each block gets its own rendered section,
  // its own meta line, and the rail becomes the exchange list instead of the heading outline.
  if (stream) {
    const blocks = found.blocks ?? [];
    // The first screen ships only the window: the head the viewport can show plus the tail
    // (the writing block). Every skipped exchange is a placeholder the client fills from
    // /api/stream-blocks. The viewport hint comes from ?vh=, then the bbvh cookie the boot
    // script writes, then 900.
    const rawVh = typeof query.vh === "string" ? Number(query.vh) : NaN;
    const cookieVh = Number((await cookies()).get("bbvh")?.value ?? NaN);
    const viewportH = Number.isFinite(rawVh) && rawVh > 0 ? rawVh : Number.isFinite(cookieVh) && cookieVh > 0 ? cookieVh : DEFAULT_VIEWPORT_H;
    const window = planStreamWindow(blocks, viewportH);
    const rendered = new Set([...window.head, ...window.tail]);
    const nodes = await Promise.all(
      blocks.map(async (b, i) => ({
        id: b.id,
        n: b.n,
        action: b.action,
        author: b.author,
        when: relativeTime(b.at),
        writing: b.status === "writing",
        html: rendered.has(i) ? (await renderMarkdown(b.body, { assetBase: `/api/asset/${id}` })).html : null,
      })),
    );
    const loaded = nodes.filter((n): n is typeof n & { html: string } => n.html !== null).map(({ html, ...n }) => ({ ...n, html }));
    // A placeholder near the window keeps its meta line; the far ones ship only id + height.
    // At a few hundred skipped exchanges the meta lines alone would cost more than the text.
    const headLast = window.head.length ? window.head[window.head.length - 1] : -1;
    const tailFirst = window.tail.length ? window.tail[0] : window.total;
    const pending = blocks.map((b, i) => ({ b, i })).filter(({ i }) => !rendered.has(i)).map(({ b, i }) => ({
      id: b.id,
      n: b.n,
      action: b.action,
      author: b.author,
      when: relativeTime(b.at),
      writing: b.status === "writing",
      est: window.estimates[i],
      bare: i > headLast + PENDING_META_BAND && i < tailFirst - PENDING_META_BAND,
    }));
    const rail = tocFromBlocks(blocks);
    const stream = pending.length > 0 ? { id: session.id, total: window.total, epoch: window.epoch, vh: viewportH } : undefined;
    return (
      <>
        <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={rail.length > 1} />
        <DocView
          key={session.id}
          session={session.id}
          title={row.title}
          path={session.path}
          html={found.body ?? ""}
          bodySlot={<StreamBody nodes={loaded} pending={pending} />}
          bodyHtml={window.epoch}
          stream={stream}
          pinTail
          initialComments={found.comments.docs[doc] ?? []}
          reviews={found.comments.reviews.filter((r) => r.doc === doc)}
          header={header}
          toc={rail.length > 1 ? <Toc toc={rail} label="Timeline" /> : null}
        />
      </>
    );
  }
  // The doc is read once: the same string feeds the markdown pass and the comments pane.
  const src = found.body ?? "";
  const { html, toc } = await renderMarkdown(src, { assetBase: `/api/asset/${id}` });
  const renderedComments = found.comments.docs[doc] ?? [];
  const reviews = found.comments.reviews.filter((r) => r.doc === doc);
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

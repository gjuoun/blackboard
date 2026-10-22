import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { DocView } from "@/components/DocView";
import { RegisterTab } from "@/components/RegisterTab";
import { Toc } from "@/components/Toc";
import { readComments } from "@/lib/comments-store";
import { getHome } from "@/lib/home";
import { renderMarkdown } from "@/lib/markdown";
import { getSession, SCRATCHPAD_ID, scratchpadSession, servablePath, sessionCommentsPath, sessionRow } from "@/lib/sessions";

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

  // Where the file lives and its branch, as chips above the doc.
  const header = (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-1.5 text-xs" data-testid="doc-head">
      <Badge variant="outline" className="bg-card block max-w-full min-w-0 truncate font-mono font-normal" data-testid="doc-location" title={row.path}>
        {row.location}
      </Badge>
      {row.branch ? (
        <Badge variant="outline" className="bg-card font-mono font-normal" data-testid="doc-branch" title="git branch">
          ⎇ {row.branch}
        </Badge>
      ) : null}
      {row.missing ? <Badge variant="destructive">missing</Badge> : null}
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

  const { html, toc } = await renderMarkdown(readFileSync(file, "utf8"));
  const doc = basename(file);
  return (
    <>
      <RegisterTab id={session.id} title={row.title} path={session.path} readable hasToc={toc.length > 0} />
      <DocView
        key={session.id}
        session={session.id}
        title={row.title}
        path={session.path}
        html={html}
        initialComments={readComments(sessionCommentsPath(home, session.id)).docs[doc] ?? []}
        header={header}
        toc={toc.length > 0 ? <Toc toc={toc} /> : null}
      />
    </>
  );
}

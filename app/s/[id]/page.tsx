import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DocHeader } from "@/components/DocHeader";
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

  if (!file) {
    return (
      <div className="doc-layout">
        <RegisterTab id={session.id} title={row.title} path={session.path} />
        <DocHeader row={row} />
        <main className="doc-missing" data-testid="doc-missing">
          <h1>{row.title}</h1>
          <p className="muted">
            This file is missing or no longer a markdown file: <code>{session.path}</code>
          </p>
          <p className="muted">
            Open its new location with <code>blackboard open &lt;file&gt;</code>.
          </p>
        </main>
      </div>
    );
  }

  const { html, toc } = await renderMarkdown(readFileSync(file, "utf8"));
  const doc = basename(file);
  return (
    <div className="doc-layout">
      <RegisterTab id={session.id} title={row.title} path={session.path} />
      <DocHeader row={row} />
      <aside className="sidebar">
        <Toc toc={toc} />
      </aside>
      <DocView
        key={session.id}
        session={session.id}
        title={row.title}
        path={session.path}
        html={html}
        initialComments={readComments(sessionCommentsPath(home, session.id)).docs[doc] ?? []}
      />
    </div>
  );
}

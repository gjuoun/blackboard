import { basename, dirname } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import type { RenderedComment } from "@/lib/comment-markdown";
import { getHome } from "@/lib/home";
import type { TocEntry } from "@/lib/markdown";
import { renderMarkdown } from "@/lib/markdown";
import { docKey, type Session, servablePath, tildify } from "@/lib/session-model";
import { loadSession } from "@/lib/session-view";
import type { SessionRow } from "@/lib/sessions";

/**
 * One session, assembled on the server and handed to the route as plain data. Everything a page
 * needs that cannot cross to the browser — the disk, the API origin, the markdown renderer —
 * happens here; the route composes the JSX from the strings this returns.
 */

/** The header chips' contents, already formatted: `tildify` reads the home directory, so it stays here. */
export type SessionHeader = {
  id: string;
  path: string;
  location: string;
  projectName: string;
  projectRoot: string;
  branch: string | null;
  detached: boolean;
  worktreeName: string | null;
  worktreePath: string | null;
  missing: boolean;
  title: string;
  open: number;
  sections: number;
  diagrams: number;
};

export type SessionPayload =
  | { kind: "missing-file"; header: SessionHeader; sessionPath: string }
  | {
      kind: "doc";
      header: SessionHeader;
      sessionPath: string;
      html: string;
      toc: TocEntry[];
      comments: RenderedComment[];
    };

const headerOf = (session: Session, row: SessionRow): SessionHeader => {
  const project = row.project ?? { name: basename(dirname(row.path)), root: dirname(row.path) };
  return {
    id: session.id,
    path: session.path,
    location: tildify(row.path),
    projectName: project.name,
    projectRoot: project.root,
    branch: row.branch,
    detached: row.detached,
    worktreeName: row.worktree?.name ?? null,
    worktreePath: row.worktree?.path ?? null,
    missing: row.missing,
    title: row.title,
    open: row.open,
    sections: row.stats.sections,
    diagrams: row.stats.diagrams,
  };
};

export const loadSessionPage = createServerFn({ method: "GET" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<SessionPayload | null> => {
    const found = await loadSession(getHome(), data.id);
    if (!found) return null;
    const { session, row } = found;
    const header = headerOf(session, row);
    const file = servablePath(session);

    if (!file) return { kind: "missing-file", header, sessionPath: session.path };

    const doc = docKey(session);
    const comments = found.comments.docs[doc] ?? [];
    const { html, toc } = await renderMarkdown(found.body ?? "", { assetBase: `/api/asset/${data.id}` });
    return { kind: "doc", header, sessionPath: session.path, html, toc, comments };
  });

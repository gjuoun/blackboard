import { readFileSync } from "node:fs";
import { readComments } from "./comments-store";
import { getDiffSnapshot, type DiffTotals } from "./diff-index";
import { docMeta } from "./doc-meta";
import { diffCommand, parsePrFrontmatter } from "./pr-kind";
import { resolveSession, sessionCommentsPath, type SessionKind } from "./sessions";

/**
 * The machine-readable answer for one session, shared by the CLI's --json output and the HTTP
 * route so an agent never has to parse human text: what the doc's front matter is, which commit
 * the diff is pinned to, the exact git command for that diff, the file list and the open-comment
 * count. A plain session answers honestly with base and command null instead of a borrowed diff.
 */
export type PrStatusFile = { path: string; status: string; additions: number; deletions: number; binary: boolean };
export type PrStatus = {
  session: string;
  path: string;
  kind: SessionKind;
  repo: { name: string; root: string } | null;
  frontmatter: Record<string, unknown> | null;
  base: { ref: string; sha: string } | null;
  command: string | null;
  files: PrStatusFile[];
  totals: DiffTotals | null;
  comments: { open: number };
};

/** Open comments in the session, across every doc key the store holds. */
function openComments(home: string, id: string): number {
  try {
    return Object.values(readComments(sessionCommentsPath(home, id)).docs)
      .flat()
      .filter((c) => c.status === "open").length;
  } catch {
    return 0;
  }
}

/** Null when the ref names no session; a missing doc still answers with its last-known metadata. */
export function prStatus(home: string, ref: string, cwd = process.cwd()): PrStatus | null {
  const session = resolveSession(home, ref, cwd);
  if (!session) return null;
  let src = "";
  try {
    src = readFileSync(session.path, "utf8");
  } catch {
    src = "";
  }
  const fm = parsePrFrontmatter(src);
  const meta = docMeta(session.path, sessionCommentsPath(home, session.id));
  const kind: SessionKind = session.kind ?? "plain";
  const base = kind === "pr" && fm.baseSha ? { ref: fm.base ?? "main", sha: fm.baseSha } : null;
  const snapshot = meta.repo && base ? getDiffSnapshot(meta.repo.root, { baseRef: base.ref, base: base.sha }) : null;
  return {
    session: session.id,
    path: session.path,
    kind,
    repo: meta.repo ? { name: meta.repo.name, root: meta.repo.root } : null,
    frontmatter: fm.frontmatter,
    base,
    command: meta.repo && base ? diffCommand(meta.repo.root, base.sha) : null,
    files: snapshot ? snapshot.files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions, binary: f.binary })) : [],
    totals: snapshot ? snapshot.totals : null,
    comments: { open: openComments(home, session.id) },
  };
}

import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { CommentsStore } from "./comments-store";
import { getDiffSnapshot, type DiffTotals } from "./diff-index";
import { docMeta } from "./doc-meta";
import { IoFailure, type LockTimeout } from "./effect/errors";
import { diffCommand, parsePrFrontmatter } from "./pr-kind";
import { sessionCommentsPath, SessionsStore, type SessionKind } from "./sessions";

/**
 * The machine-readable answer for one session, shared by the CLI --json output and the HTTP
 * route so an agent never has to parse human text: what the doc front matter is, which commit
 * the diff is pinned to, the exact git command for that diff, the file list and the open-comment
 * count. A plain session answers honestly with base and command null instead of a borrowed diff.
 */
type PrStatusFile = { path: string; status: string; additions: number; deletions: number; binary: boolean };
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

/** Open comments in the session, across every doc key the store holds. An unreadable file counts as none. */
const openComments = (home: string, id: string) =>
  Effect.gen(function* () {
    const comments = yield* CommentsStore;
    return yield* comments.read(sessionCommentsPath(home, id)).pipe(
      Effect.map((file) => Object.values(file.docs).flat().filter((c) => c.status === "open").length),
      Effect.catch(() => Effect.succeed(0)),
    );
  });

const readDoc = (path: string): Effect.Effect<string> =>
  Effect.try({ try: () => readFileSync(path, "utf8"), catch: () => "unreadable" as const }).pipe(
    Effect.catch(() => Effect.succeed("")),
  );

/** Null when the ref names no session; a missing doc still answers with its last-known metadata. */
export function prStatus(
  home: string,
  ref: string,
  cwd = process.cwd(),
): Effect.Effect<PrStatus | null, IoFailure | LockTimeout, SessionsStore | CommentsStore> {
  return Effect.gen(function* () {
    const sessions = yield* SessionsStore;
    const session = yield* sessions.resolve(home, ref, cwd);
    if (!session) return null;
    const src = yield* readDoc(session.path);
    const fm = parsePrFrontmatter(src);
    const meta = yield* Effect.sync(() => docMeta(session.path, sessionCommentsPath(home, session.id)));
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
      comments: { open: yield* openComments(home, session.id) },
    };
  });
}
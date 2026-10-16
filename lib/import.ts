import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { mutate, readComments, type Comment } from "./comments-store";
import { expandHome } from "./home";
import { openSession, realDoc, sessionCommentsPath, sessionId } from "./sessions";

export type ImportSkip = { doc: string; reason: string };
export type ImportResult = {
  /** Comments copied (or, in a dry run, that would be). */
  imported: number;
  /** Sessions that received comments. */
  sessions: number;
  /** Docs imported, as "<board>/<doc>" with their comment count. */
  done: { doc: string; path: string; comments: number }[];
  skipped: ImportSkip[];
};

const inside = (dir: string, p: string) => {
  const rel = relative(dir, p);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * Bring comments from the old "folder of boards" layout into sessions. For every first-level,
 * non-hidden folder of `root` with a `.blackboard/comments.json`, each doc that has comments and
 * still exists is registered as a session and its comments are copied over. A session that
 * already has comments is skipped, so re-running is safe. The old files are only read.
 */
export async function importBoards(home: string, root: string, opts: { dryRun?: boolean } = {}): Promise<ImportResult> {
  const out: ImportResult = { imported: 0, sessions: 0, done: [], skipped: [] };
  const rootDir = resolve(expandHome(root));
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const boardDir = realpathSync(join(rootDir, entry.name));
    const legacy = join(boardDir, ".blackboard", "comments.json");
    if (!existsSync(legacy)) continue;
    let docs: Record<string, Comment[]>;
    try {
      docs = readComments(legacy).docs;
    } catch {
      out.skipped.push({ doc: `${entry.name}/.blackboard/comments.json`, reason: "comment file does not parse" });
      continue;
    }
    for (const [doc, list] of Object.entries(docs)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      const label = `${entry.name}/${doc}`;
      let real: string;
      try {
        real = realDoc(join(boardDir, doc));
      } catch {
        out.skipped.push({ doc: label, reason: "doc no longer exists" });
        continue;
      }
      if (!inside(boardDir, real)) {
        out.skipped.push({ doc: label, reason: "outside its board" });
        continue;
      }
      const target = sessionCommentsPath(home, sessionId(real));
      if (Object.values(readComments(target).docs).some((l) => l.length > 0)) {
        out.skipped.push({ doc: label, reason: "session already has comments" });
        continue;
      }
      if (!opts.dryRun) {
        const session = openSession(home, real);
        await mutate(sessionCommentsPath(home, session.id), (f) => {
          f.docs[basename(real)] = list;
        });
      }
      out.imported += list.length;
      out.sessions += 1;
      out.done.push({ doc: label, path: real, comments: list.length });
    }
  }
  return out;
}

export function formatImport(r: ImportResult, dryRun = false): string {
  const lines = [
    ...r.done.map((d) => `+ ${d.doc}  (${d.comments} comment${d.comments === 1 ? "" : "s"})`),
    ...r.skipped.map((s) => `- ${s.doc}: ${s.reason}`),
    `${dryRun ? "would import" : "imported"} ${r.imported} comment${r.imported === 1 ? "" : "s"} into ${r.sessions} session${r.sessions === 1 ? "" : "s"}, skipped ${r.skipped.length}`,
  ];
  return lines.join("\n");
}

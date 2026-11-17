import { readFileSync, writeFileSync } from "node:fs";
import { Safe } from "@gjuoun/safe-ts";
import { eq } from "drizzle-orm";
import { type CliError, cliFailure, find } from "../cli";
import type { Db } from "../db/client";
import type { ContentBlocksRepo } from "../db/repos/content-blocks";
import { documents } from "../db/schema";
import { RepoMemo } from "../doc-index";
import { indexRow } from "../doc-index-run";
import type { Session, SessionsStore } from "../sessions";

/**
 * `blackboard blocks` and `blackboard patch`: the agent-facing block edit surface. `blocks` lists the
 * live paragraph blocks with ids; `patch` edits one block's text. Both are local-lane only: they need
 * the database and, for file docs, the file on disk.
 */

export type BlockLine = { id: string; n: number; grp: number; kind: string; rev: number; text: string };

const localOnly = () => process.versions.bun !== undefined;

const notLocal = (message: string): CliError => ({ CliError: { message, code: 1 } });

/** The doc's live paragraph blocks, in order. */
export function blocks(
  contentBlocks: ContentBlocksRepo,
  sessions: SessionsStore,
  home: string,
  ref: string,
): Safe<BlockLine[], CliError> {
  return Safe.try(function* () {
    const { session } = (yield find(sessions, home, ref)) as { session: Session };
    if (!localOnly())
      return (yield Safe.err(notLocal("blocks reads the local database — run it under bun"))) as never;
    const rows = (yield contentBlocks.list(home, session.id)) as Awaited<
      ReturnType<ContentBlocksRepo["list"]>
    > extends Safe<infer A, infer _E>
      ? A
      : never;
    return rows.map((r) => ({ id: r.id, n: r.n, grp: r.grp, kind: r.kind, rev: r.rev, text: r.text }));
  }) as unknown as Safe<BlockLine[], CliError>;
}

/** Count non-overlapping occurrences. */
const occurrences = (hay: string, needle: string) => {
  let n = 0;
  let at = 0;
  while (needle && (at = hay.indexOf(needle, at)) >= 0) {
    n++;
    at += needle.length;
  }
  return n;
};

export type PatchResult = { blockId: string; session: string; rev: number; text: string };

/**
 * Rewrite one block's text. `--id` names the block; `--old` (optional) scopes the replacement inside
 * that block's text and must occur exactly once — the whole block is replaced otherwise. The file is
 * spliced and reindexed.
 */
export function patch(
  db: Db,
  contentBlocks: ContentBlocksRepo,
  sessions: SessionsStore,
  home: string,
  ref: string,
  input: { id: string; old?: string; next: string; author: string },
): Safe<PatchResult, CliError> {
  return Safe.try(function* () {
    const { session } = (yield find(sessions, home, ref)) as { session: Session };
    if (!localOnly())
      return (yield Safe.err(
        notLocal("patch edits the local file and database — run it under bun"),
      )) as never;
    if (!input.next.trim())
      return (yield Safe.err({
        CliError: { message: "patch needs non-empty --new text", code: 2 },
      })) as never;

    const block = (yield contentBlocks.get(home, input.id)) as {
      documentId: string;
      deletedAt: string | null;
      text: string;
    } | null;
    if (!block || block.documentId !== session.id || block.deletedAt)
      return (yield Safe.err(
        notLocal(`no live block ${input.id} on ${session.id} (list with: blackboard blocks ${ref})`),
      )) as never;

    // Apply the edit inside the block's text.
    let newBlockText: string;
    if (input.old !== undefined && input.old !== "") {
      const count = occurrences(block.text, input.old);
      if (count === 0) return (yield Safe.err(notLocal(`--old does not occur inside ${input.id}`))) as never;
      if (count > 1)
        return (yield Safe.err(
          notLocal(`--old occurs ${count} times inside ${input.id} — pass more context`),
        )) as never;
      newBlockText = block.text.replace(input.old, input.next);
    } else {
      newBlockText = input.next;
    }

    if (!session.path) return (yield Safe.err(notLocal(`${session.id} has no file to patch`))) as never;
    const path = session.path;
    const src = (yield Safe.call(
      () => readFileSync(path, "utf8"),
      (error) => cliFailure({ message: `read ${path}: ${(error as Error).message}` }),
    )) as string;
    const count = occurrences(src, block.text);
    if (count === 0)
      return (yield Safe.err(
        notLocal(`${input.id}'s text is no longer in the file — reindex first`),
      )) as never;
    if (count > 1)
      return (yield Safe.err(
        notLocal(`${input.id}'s text occurs ${count} times in the file — patch refused`),
      )) as never;
    yield Safe.call(
      () => writeFileSync(path, src.replace(block.text, newBlockText)),
      (error) => cliFailure({ message: `write ${path}: ${(error as Error).message}` }),
    );
    // Reindex the same way the file watcher would: mtime/size moved, body and content blocks rewrite
    // inside one db.use.
    const row = (yield db.use(
      home,
      (d) => d.select().from(documents).where(eq(documents.id, session.id)).get() ?? null,
    )) as typeof documents.$inferSelect | null;
    if (row) yield indexRow(db, home, row, new RepoMemo(), true);

    const after = (yield contentBlocks.get(home, input.id)) as { rev: number } | null;
    return { blockId: input.id, session: session.id, rev: after?.rev ?? 0, text: newBlockText };
  }) as unknown as Safe<PatchResult, CliError>;
}

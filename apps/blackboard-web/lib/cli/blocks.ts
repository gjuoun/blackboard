import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { cliFailure, CliError, find } from "../cli";
import { ContentBlocksRepo, layer as contentBlocksLayer } from "../db/repos/content-blocks";
import { Db, layer as dbLayer } from "../db/client";
import { documents } from "../db/schema";
import { indexRow } from "../doc-index-run";
import { RepoMemo } from "../doc-index";
import { SessionsStore } from "../sessions";
import { StreamsStore, layer as streamsLayer } from "../stream-store";

/**
 * `blackboard blocks` and `blackboard patch`: the agent-facing block edit surface. `blocks`
 * lists the live paragraph blocks with ids; `patch` edits one block's text. Both are local-lane
 * only: they need the database and, for file docs, the file on disk.
 */

export type BlockLine = { id: string; n: number; grp: number; kind: string; rev: number; text: string };

const provide = <A, E>(effect: Effect.Effect<A, E, SessionsStore | StreamsStore | ContentBlocksRepo | Db>) =>
  effect.pipe(Effect.provide(contentBlocksLayer), Effect.provide(streamsLayer), Effect.provide(dbLayer));

const localOnly = () => process.versions.bun !== undefined;

/** The doc's live paragraph blocks, in order. */
export function blocks(home: string, ref: string): Effect.Effect<BlockLine[], CliError, SessionsStore | ContentBlocksRepo | Db> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref);
    if (!localOnly()) return yield* new CliError({ message: "blocks reads the local database — run it under bun", code: 1 });
    return yield* provide(Effect.gen(function* () {
      const repo = yield* ContentBlocksRepo;
      const rows = yield* repo.list(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
      return rows.map((r) => ({ id: r.id, n: r.n, grp: r.grp, kind: r.kind, rev: r.rev, text: r.text }));
    }));
  });
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
 * Rewrite one block's text. `--id` names the block; `--old` (optional) scopes the replacement
 * inside that block's text and must occur exactly once — the whole block is replaced otherwise.
 * File docs get the file spliced and reindexed; stream docs get the spliced body appended as an
 * `edit` exchange, which refolds and reconciles in the same pass.
 */
export function patch(
  home: string,
  ref: string,
  input: { id: string; old?: string; next: string; author: string },
): Effect.Effect<PatchResult, CliError, SessionsStore | ContentBlocksRepo | Db | StreamsStore> {
  return Effect.gen(function* () {
    const { session } = yield* find(home, ref);
    if (!localOnly()) return yield* new CliError({ message: "patch edits the local file and database — run it under bun", code: 1 });
    if (!input.next.trim()) return yield* new CliError({ message: "patch needs non-empty --new text", code: 2 });

    return yield* provide(Effect.gen(function* () {
      const repo = yield* ContentBlocksRepo;
      const block = yield* repo.get(home, input.id).pipe(Effect.mapError((error) => cliFailure(error)));
      if (!block || block.documentId !== session.id || block.deletedAt) {
        return yield* new CliError({ message: `no live block ${input.id} on ${session.id} (list with: blackboard blocks ${ref})`, code: 1 });
      }

      // Apply the edit inside the block's text.
      let newBlockText: string;
      if (input.old !== undefined && input.old !== "") {
        const count = occurrences(block.text, input.old);
        if (count === 0) return yield* new CliError({ message: `--old does not occur inside ${input.id}`, code: 1 });
        if (count > 1) return yield* new CliError({ message: `--old occurs ${count} times inside ${input.id} — pass more context`, code: 1 });
        newBlockText = block.text.replace(input.old, input.next);
      } else {
        newBlockText = input.next;
      }

      if (session.kind === "stream") {
        // The body lives in the exchange list: a patch appends an `edit` exchange carrying the
        // spliced document, exactly what `blackboard block --action edit` does by hand.
        const streams = yield* StreamsStore;
        const body = yield* streams.body(home, session.id).pipe(Effect.mapError((error) => cliFailure(error)));
        if (!body || occurrences(body, block.text) !== 1) {
          return yield* new CliError({ message: `${input.id} is not uniquely present in the folded body — patch refused`, code: 1 });
        }
        yield* streams.append(home, session.id, { action: "edit", body: body.replace(block.text, newBlockText), author: input.author }).pipe(Effect.mapError((error) => cliFailure(error)));
      } else {
        if (!session.path) return yield* new CliError({ message: `${session.id} has no file to patch`, code: 1 });
        const path = session.path;
        const src = yield* Effect.try({ try: () => readFileSync(path, "utf8"), catch: (error) => cliFailure({ message: `read ${path}: ${(error as Error).message}` }) });
        const count = occurrences(src, block.text);
        if (count === 0) return yield* new CliError({ message: `${input.id}'s text is no longer in the file — reindex first`, code: 1 });
        if (count > 1) return yield* new CliError({ message: `${input.id}'s text occurs ${count} times in the file — patch refused`, code: 1 });
        yield* Effect.try({ try: () => writeFileSync(path, src.replace(block.text, newBlockText)), catch: (error) => cliFailure({ message: `write ${path}: ${(error as Error).message}` }) });
        // Reindex the same way the file watcher would: mtime/size moved, body and content
        // blocks rewrite inside one db.use.
        const db = yield* Db;
        const row = yield* db.use(home, (d) => d.select().from(documents).where(eq(documents.id, session.id)).get() ?? null).pipe(Effect.mapError((error) => cliFailure(error)));
        if (row) yield* indexRow(db, home, row, new RepoMemo(), true).pipe(Effect.mapError((error) => cliFailure(error)));
      }

      const after = yield* repo.get(home, input.id).pipe(Effect.mapError((error) => cliFailure(error)));
      return { blockId: input.id, session: session.id, rev: after?.rev ?? 0, text: newBlockText };
    }));
  });
}

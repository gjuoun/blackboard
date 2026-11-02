/**
 * The write side of a streaming document. A `.jsonl` file opens with one metadata line (the document
 * id and title) and holds one block per line after it; a block id appears once.
 *
 * - Creating writes the metadata line only, and never overwrites a file that already has content.
 * - Append adds one line at the end. An empty file gets the metadata line first, in the same append.
 * - Changing an existing block rewrites the whole file: read every line, replace the one with that id,
 *   write a temp file in the same folder, then rename() it over the original. The metadata line is
 *   written back exactly as it was read. The history of the file is git territory; there is no event log.
 * - writeMeta adds or updates the metadata line on an existing file (migration), keeping every block
 *   in place. Its id and creation time are kept, so running it twice changes nothing.
 * - Every write holds `<file>.lock`, created with wx. A lock older than STREAM_STALE_MS is taken over.
 *
 * Reads never take the lock. A truncated last line is skipped by the parser.
 */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { Context, Effect, Layer } from "effect";
import { errorMessage, IoFailure, type LockTimeout } from "./effect/errors";
import { Lock, STREAM_STALE_MS, type LockOptions } from "./lock";
import { ulid } from "./ulid";
import {
  blockLine,
  metaLine,
  newStreamMeta,
  parseStream,
  STREAM_ACTIONS,
  type StreamAction,
  type StreamBlock,
  type StreamMeta,
} from "./stream-doc";

type NewBlock = { action: StreamAction; author: string; text: string; images?: string[]; status?: "writing" };
/** What a fresh metadata line needs; the id and time are the store's. */
type StreamMetaInput = { title: string; owner?: string };
export type HeaderResult = { meta: StreamMeta; created: boolean; blocks: number };

const failure = (error: unknown) => new IoFailure({ message: errorMessage(error), status: 500 });
const readText = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const fallbackTitle = (file: string) => basename(file).replace(/\.jsonl$/i, "");

/** The stream lock only checks age: a long writer may still be alive. */
const LOCK: LockOptions = {
  staleMs: STREAM_STALE_MS,
  checkHolder: false,
  timeoutMessage: (lockPath) => `stream is locked by another writer: ${lockPath}`,
};

/** Temp file in the same folder, then rename(): the reader sees the old file or the new one, never half. */
function writeAtomic(file: string, body: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
}

/** The block writer for stream sessions: every write takes the stream lock, every read takes none. */
export class StreamStore extends Context.Service<
  StreamStore,
  {
    create(file: string, input: StreamMetaInput, at?: string): Effect.Effect<{ meta: StreamMeta | null; created: boolean }, IoFailure | LockTimeout>;
    append(file: string, input: NewBlock, at?: string, meta?: { title?: string; owner?: string }): Effect.Effect<StreamBlock, IoFailure | LockTimeout>;
    rewrite(file: string, id: string, change: (block: StreamBlock) => StreamBlock): Effect.Effect<StreamBlock, IoFailure | LockTimeout>;
    writeMeta(file: string, input: { title: string; owner?: string }, at?: string): Effect.Effect<HeaderResult, IoFailure | LockTimeout>;
    read(file: string): Effect.Effect<string, IoFailure>;
  }
>()("blackboard/StreamStore") {}

export const layer = Layer.effect(
  StreamStore,
  Effect.gen(function* () {
    const lock = yield* Lock;
    const under = <A>(file: string, work: () => A): Effect.Effect<A, IoFailure | LockTimeout> =>
      lock.withLock(file, Effect.try({ try: work, catch: failure }), LOCK);

    return StreamStore.of({
      read: (file) => Effect.try({ try: () => readText(file), catch: failure }),

      create: (file, input, at = new Date().toISOString()) =>
        under(file, () => {
          const text = readText(file);
          const { meta } = parseStream(text);
          if (meta) return { meta, created: false };
          if (text.trim()) return { meta: null, created: false };
          const fresh = newStreamMeta(input, at);
          writeFileSync(file, metaLine(fresh) + "\n");
          return { meta: fresh, created: true };
        }),

      append: (file, input, at = new Date().toISOString(), meta = {}) => {
        if (!(STREAM_ACTIONS as readonly string[]).includes(input.action)) {
          return Effect.fail(failure(new Error(`action takes ${STREAM_ACTIONS.join("|")}`)));
        }
        return under(file, () => {
          const text = readText(file);
          const current = parseStream(text).blocks;
          const block: StreamBlock = {
            type: "block",
            id: `b-${ulid()}`,
            n: (current.at(-1)?.n ?? 0) + 1,
            action: input.action,
            author: input.author,
            at,
            body: input.text,
            ...(input.images?.length ? { images: input.images } : {}),
            ...(input.status ? { status: input.status } : {}),
          };
          if (!text.trim()) {
            const fresh = newStreamMeta({ title: meta.title?.trim() || fallbackTitle(file), owner: meta.owner ?? input.author }, at);
            appendFileSync(file, metaLine(fresh) + "\n" + blockLine(block) + "\n");
          } else {
            appendFileSync(file, blockLine(block) + "\n");
          }
          return block;
        });
      },

      rewrite: (file, id, change) =>
        under(file, () => {
          const lines = readText(file).split("\n");
          let hit: StreamBlock | null = null;
          const out = lines.map((line) => {
            if (!line.trim()) return line;
            const block = parseStream(line).blocks[0];
            if (!block || block.id !== id) return line;
            hit = change(block);
            return blockLine(hit);
          });
          if (!hit) throw new Error(`no block ${id} in ${file}`);
          writeAtomic(file, out.join("\n"));
          return hit;
        }),

      writeMeta: (file, input, at = new Date().toISOString()) =>
        under(file, () => {
          const text = readText(file);
          const parsed = parseStream(text);
          const owner = input.owner?.trim() || parsed.meta?.owner;
          const meta: StreamMeta = parsed.meta
            ? { ...parsed.meta, title: input.title, ...(owner ? { owner } : {}) }
            : newStreamMeta({ title: input.title, ...(owner ? { owner } : {}) }, at);
          const lines = text.split("\n");
          if (parsed.meta) {
            // A parsed meta is always the first non-empty line; replace exactly that line.
            const i = lines.findIndex((line) => line.trim().length > 0);
            lines[i] = metaLine(meta);
          } else {
            lines.unshift(metaLine(meta));
          }
          writeAtomic(file, lines.join("\n"));
          return { meta, created: parsed.meta === null, blocks: parsed.blocks.length };
        }),
    });
  }),
);
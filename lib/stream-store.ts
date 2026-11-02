/**
 * The write side of a streaming document. A `.jsonl` file opens with one metadata line (the document's
 * id and title) and holds one block per line after it; a block id appears once.
 *
 * - Creating writes the metadata line only, and never overwrites a file that already has content.
 * - Append adds one line at the end. An empty file gets the metadata line first, in the same append.
 * - Changing an existing block rewrites the whole file: read every line, replace the one with that id,
 *   write a temp file in the same folder, then `rename()` it over the original. The metadata line is
 *   written back exactly as it was read. The history of the file is git's job; there is no event log.
 * - `header` adds or updates the metadata line on an existing file (migration), keeping every block
 *   in place. Its id and creation time are kept, so running it twice changes nothing.
 * - Every write holds `<file>.lock`, created with `wx`. A lock older than `STALE_MS` is taken over.
 *
 * Reads never take the lock. A truncated last line is skipped by the parser.
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename } from "node:path";
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

export const LOCK_TIMEOUT_MS = 5000;
export const STALE_MS = 30_000;

export class StreamError extends Error {}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `fn` while holding `<file>.lock`. Retries until `timeoutMs`, then fails rather than wait forever. */
export function withStreamLock<T>(file: string, fn: () => T, timeoutMs = LOCK_TIMEOUT_MS): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;
  let attempt = 0;
  while (fd === null) {
    try {
      fd = openSync(lock, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { force: true });
      if (Date.now() > deadline) throw new StreamError(`stream is locked by another writer: ${lock}`);
      attempt++;
      sleepSync(Math.min(50, 2 ** attempt));
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

export type NewBlock = { action: StreamAction; author: string; text: string; images?: string[]; status?: "writing" };
/** What a fresh metadata line needs; the id and time are the store's. */
export type StreamMetaInput = { title: string; owner?: string };

const readText = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const fallbackTitle = (file: string) => basename(file).replace(/\.jsonl$/i, "");

/**
 * Writes the metadata line for a new file. An existing file is never overwritten: a file that already
 * has metadata keeps it (created: false), and an old file with blocks is left for `writeStreamMeta`.
 */
export function createStream(file: string, input: StreamMetaInput, at = new Date().toISOString()): { meta: StreamMeta | null; created: boolean } {
  return withStreamLock(file, () => {
    const text = readText(file);
    const { meta } = parseStream(text);
    if (meta) return { meta, created: false };
    if (text.trim()) return { meta: null, created: false };
    const fresh = newStreamMeta(input, at);
    writeFileSync(file, metaLine(fresh) + "\n");
    return { meta: fresh, created: true };
  });
}

/**
 * Appends a block with a fresh ULID id. `n` is the display number: the last block's n plus one.
 * An empty file gets its metadata line in the same append, so the file is never blockless and headerless.
 */
export function appendBlock(
  file: string,
  input: NewBlock,
  at = new Date().toISOString(),
  meta: { title?: string; owner?: string } = {},
): StreamBlock {
  if (!(STREAM_ACTIONS as readonly string[]).includes(input.action)) throw new StreamError(`action takes ${STREAM_ACTIONS.join("|")}`);
  return withStreamLock(file, () => {
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
}

/**
 * Replaces the block with `id` by rewriting the whole file. The temp file sits in the same folder so the
 * `rename()` is atomic. The metadata line and every other line, including ones that are not blocks, are
 * written back exactly as they were read.
 */
export function rewriteBlock(file: string, id: string, change: (b: StreamBlock) => StreamBlock): StreamBlock {
  return withStreamLock(file, () => {
    const lines = readText(file).split("\n");
    let hit: StreamBlock | null = null;
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      const b = parseStream(line).blocks[0];
      if (!b || b.id !== id) return line;
      hit = change(b);
      return blockLine(hit);
    });
    if (!hit) throw new StreamError(`no block ${id} in ${file}`);
    writeAtomic(file, out.join("\n"));
    return hit;
  });
}

export type HeaderResult = { meta: StreamMeta; created: boolean; blocks: number };

/**
 * Adds the metadata line to an old file, or updates the title (and owner) of the one it has. Every
 * block stays in its place and unchanged. The document id and `created` are kept, so a second run
 * with the same arguments is a no-op.
 */
export function writeStreamMeta(file: string, input: { title: string; owner?: string }, at = new Date().toISOString()): HeaderResult {
  return withStreamLock(file, () => {
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
  });
}

/** Temp file in the same folder, then `rename()`: the reader sees the old file or the new one, never half. */
function writeAtomic(file: string, body: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
}

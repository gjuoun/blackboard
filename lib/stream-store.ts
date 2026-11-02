/**
 * The write side of a streaming document. A `.jsonl` file holds one block per line; an id appears once.
 *
 * - Append adds one line at the end. It needs the lock, so it cannot interleave with a rewrite.
 * - Changing an existing block rewrites the whole file: read every line, replace the one with that id,
 *   write a temp file in the same folder, then `rename()` it over the original. The history of the
 *   file is git's job; there is no event log to fold.
 * - Every write holds `<file>.lock`, created with `wx`. A lock older than `STALE_MS` is taken over.
 *
 * Reads never take the lock. A truncated last line is skipped by the parser.
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { ulid } from "./ulid";
import { parseStream, STREAM_ACTIONS, type StreamAction, type StreamBlock } from "./stream-doc";

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

const readText = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");

/** Appends a block with a fresh ULID id. `n` is the display number: the last block's n plus one. */
export function appendBlock(file: string, input: NewBlock, at = new Date().toISOString()): StreamBlock {
  if (!(STREAM_ACTIONS as readonly string[]).includes(input.action)) throw new StreamError(`action takes ${STREAM_ACTIONS.join("|")}`);
  return withStreamLock(file, () => {
    const current = parseStream(readText(file)).blocks;
    const block: StreamBlock = {
      id: `b-${ulid()}`,
      n: (current.at(-1)?.n ?? 0) + 1,
      action: input.action,
      author: input.author,
      at,
      body: input.text,
      ...(input.images?.length ? { images: input.images } : {}),
      ...(input.status ? { status: input.status } : {}),
    };
    appendFileSync(file, JSON.stringify(block) + "\n");
    return block;
  });
}

/**
 * Replaces the block with `id` by rewriting the whole file. The temp file sits in the same folder so the
 * `rename()` is atomic. Lines that are not blocks are kept as they are.
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
      return JSON.stringify(hit);
    });
    if (!hit) throw new StreamError(`no block ${id} in ${file}`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, out.join("\n"));
    renameSync(tmp, file);
    return hit;
  });
}

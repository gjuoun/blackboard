import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { eq } from "drizzle-orm";
import { run, services } from "../test/app";
import { documents } from "./db/schema";
import { indexDocuments } from "./doc-index-run";

/**
 * The index against a real database and real files, in a temp home. Each case checks what a row holds after a run,
 * and that a second run changes nothing. No mocks: the database is the one the API opens.
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A fresh temp home. Its database is created on first use. */
function freshHome(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "bb-index-")));
  dirs.push(d);
  return d;
}

/** Run one program against the shared graph. */
const runIn = <A>(effect: Safe<A, unknown>): Promise<A> => run(effect as Safe<A, never>);

/** Register a file as a document. */
const register = (home: string, id: string, path: string) =>
  runIn(
    Safe.try(function* () {
      const docs = services.documents;
      yield docs.upsert(home, { id, path });
    }),
  );

/** The index, run once. */
const indexOnce = (home: string) => run(indexDocuments(services.db, home) as Safe<IndexShape, never>);

type IndexShape = { scanned: number; updated: number; skipped: number; missing: number; gitCommands: number };

/** The stored row for a document. */
const rowOf = (home: string, id: string) =>
  run(
    Safe.try(function* () {
      const db = services.db;
      return yield db.use(home, (d) => d.select().from(documents).where(eq(documents.id, id)).get() ?? null);
    }) as Safe<typeof documents.$inferSelect | null, never>,
  );

describe("the index reads a document into its row", () => {
  test("a registered file gets its body, title and counts, and a second run changes nothing", async () => {
    const home = freshHome();
    const file = join(home, "plan.md");
    writeFileSync(file, "# Plan\n\n## One\n\nbody\n\n## Two\n\nmore\n");
    await register(home, "p1", file);
    const first = await indexOnce(home);
    expect(first.updated).toBe(1);
    const row = await rowOf(home, "p1");
    expect(row?.body).toContain("## Two");
    expect(row?.title).toBe("Plan");
    expect(row?.sections).toBe(2);
    const second = await indexOnce(home);
    expect(second).toMatchObject({ updated: 0, skipped: 1 });
  });
});

describe("the index follows the file", () => {
  test("an edited file is re-read on the next run, and only that file", async () => {
    const home = freshHome();
    const a = join(home, "a.md");
    const b = join(home, "b.md");
    writeFileSync(a, "# A\n\none\n");
    writeFileSync(b, "# B\n\ntwo\n");
    await register(home, "ia", a);
    await register(home, "ib", b);
    expect((await indexOnce(home)).updated).toBe(2);
    // Bump the size so the change is visible even when the mtime granularity is coarse.
    writeFileSync(a, "# A\n\nchanged text here\n");
    const next = await indexOnce(home);
    expect(next).toMatchObject({ updated: 1, skipped: 1 });
    expect((await rowOf(home, "ia"))?.body).toContain("changed text here");
    expect((await rowOf(home, "ib"))?.body).toContain("two");
  });

  test("a file that goes missing is recorded as missing, and that record is stable across runs", async () => {
    const home = freshHome();
    const f = join(home, "gone.md");
    writeFileSync(f, "# Gone\n");
    await register(home, "ig", f);
    await indexOnce(home);
    unlinkSync(f);
    const missing = await indexOnce(home);
    expect(missing).toMatchObject({ missing: 1, updated: 1 });
    expect((await rowOf(home, "ig"))?.body).toBeNull();
    // The file is still gone: the recorded state is the current state, so nothing is rewritten.
    expect(await indexOnce(home)).toMatchObject({ updated: 0, missing: 0 });
  });

  test("a path-less stream row is never file-indexed, even under --force", async () => {
    const home = freshHome();
    await runIn(
      Safe.try(function* () {
        const docs = services.documents;
        yield docs.upsert(home, { id: "s-stream1", path: null, kind: "stream" });
      }),
    );
    const first = await indexOnce(home);
    expect(first).toMatchObject({ scanned: 1, updated: 0, missing: 0 });
    const forced = await run(indexDocuments(services.db, home, true) as Safe<IndexShape, never>);
    expect(forced.updated).toBe(0);
    expect((await rowOf(home, "s-stream1"))?.body).toBeNull();
  });

  test("--force re-reads every document, even one whose file has not changed", async () => {
    const home = freshHome();
    const f = join(home, "same.md");
    writeFileSync(f, "# Same\n");
    await register(home, "is", f);
    await indexOnce(home);
    expect((await indexOnce(home)).updated).toBe(0);
    const forced = await run(indexDocuments(services.db, home, true) as Safe<IndexShape, never>);
    expect(forced.updated).toBe(1);
  });
});

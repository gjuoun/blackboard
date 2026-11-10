import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Db, layer as dbLayer } from "./db/client";
import { documents } from "./db/schema";
import { DocumentsRepo, layer as documentsLayer } from "./db/repos/documents";
import { startDocWatch } from "./doc-watch";
import { Layer } from "effect";

/**
 * A change to an indexed file reaches its row without anyone opening the page: the watcher re-reads the file and
 * writes the new body. Timed against a real file system; the budget is 3 s, looser than the 2 s the feature promises,
 * so a slow machine does not fail it spuriously.
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const layers = documentsLayer.pipe(Layer.provide(dbLayer));
const runIn = <A>(effect: Effect.Effect<A, unknown, Db | DocumentsRepo>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(layers)) as Effect.Effect<A, never, never>);
const runDb = <A>(effect: Effect.Effect<A, unknown, Db>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(dbLayer)) as Effect.Effect<A, never, never>);

const bodyOf = (home: string, id: string) =>
  runDb(Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.use(home, (d) => d.select({ body: documents.body }).from(documents).where(eq(documents.id, id)).get()?.body ?? null);
  }));

async function until(check: () => Promise<boolean>, budgetMs: number): Promise<number | null> {
  const t0 = performance.now();
  while (performance.now() - t0 < budgetMs) {
    if (await check()) return Math.round(performance.now() - t0);
    await Bun.sleep(25);
  }
  return null;
}

describe("an edit to an indexed file reaches its row", () => {
  test("the row carries the new body within the budget, without any page being open", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "bb-watch-")));
    dirs.push(home);
    const file = join(home, "live.md");
    writeFileSync(file, "# Live\n\nfirst\n");
    await runIn(Effect.gen(function* () {
      const docs = yield* DocumentsRepo;
      yield* docs.upsert(home, { id: "lv1", path: file });
    }));
    // Index it once through the same path the API uses, so the watch edits an indexed row.
    const { indexDocuments } = await import("./doc-index-run");
    await runDb(indexDocuments(home));
    expect(await bodyOf(home, "lv1")).toContain("first");

    const stop = startDocWatch(home, runDb as never);
    try {
      await Bun.sleep(150); // let the directory watcher attach before the write
      writeFileSync(file, "# Live\n\nsecond edit with more text\n");
      const ms = await until(async () => ((await bodyOf(home, "lv1")) ?? "").includes("second edit"), 3000);
      expect(ms).not.toBeNull();
      expect(ms!).toBeLessThan(3000);
    } finally {
      stop();
    }
  }, 15_000);
});


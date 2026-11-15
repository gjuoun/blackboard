import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Result } from "effect";
import { layer as dbLayer } from "./db/client";
import { DocumentsRepo, layer as documentsLayer } from "./db/repos/documents";
import { StreamsStore, layer as streamsLayer, type StreamFailure } from "./stream-store";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-stream-")));

const run = <A>(effect: Effect.Effect<A, StreamFailure, StreamsStore>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(streamsLayer), Effect.provide(dbLayer)));

/** A run that answers the typed failure's message instead of throwing it. */
const fails = async <A>(effect: Effect.Effect<A, StreamFailure, StreamsStore>): Promise<string> => {
  const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(streamsLayer), Effect.provide(dbLayer)));
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const failure = Cause.findError(exit.cause);
  if (Result.isSuccess(failure)) return failure.success.message;
  throw Cause.squash(exit.cause);
};

const open = (home: string, title = "Log") => run(Effect.gen(function* () { const s = yield* StreamsStore; return yield* s.create(home, title); }));

describe("StreamsStore", () => {
  test("create registers a path-less stream session, indexed from birth", async () => {
    const home = fresh();
    const s = await open(home, "Log");
    expect(s.id).toMatch(/^s-/);
    expect(s.kind).toBe("stream");
    const body = await run(Effect.gen(function* () { const s2 = yield* StreamsStore; return yield* s2.body(home, s.id); }));
    expect(body).toBe("");
  });

  test("append writes the block and refolds documents.body", async () => {
    const home = fresh();
    const s = await open(home);
    const b = await run(Effect.gen(function* () {
      const st = yield* StreamsStore;
      return yield* st.append(home, s.id, { action: "answer", body: "# First", author: "agent" });
    }));
    expect(b.n).toBe(1);
    expect(b.id).toMatch(/^b-/);
    const b2 = await run(Effect.gen(function* () {
      const st = yield* StreamsStore;
      return yield* st.append(home, s.id, { action: "append", body: "second", author: "jun", status: "writing" });
    }));
    expect(b2.n).toBe(2);
    expect(b2.status).toBe("writing");
    const body = await run(Effect.gen(function* () { const st = yield* StreamsStore; return yield* st.body(home, s.id); }));
    expect(body).toBe("# First\n\nsecond\n");
  });

  test("a new block closes the earlier writing block", async () => {
    const home = fresh();
    const s = await open(home);
    await run(Effect.gen(function* () { const st = yield* StreamsStore; return yield* st.append(home, s.id, { action: "answer", body: "draft", author: "a", status: "writing" }); }));
    await run(Effect.gen(function* () { const st = yield* StreamsStore; return yield* st.append(home, s.id, { action: "append", body: "next", author: "a" }); }));
    const all = await run(Effect.gen(function* () { const st = yield* StreamsStore; return yield* st.blocks(home, s.id); }));
    expect(all[0].status).toBeNull();
    expect(all[1].status).toBeNull();
  });

  test("edit action block replaces the document body", async () => {
    const home = fresh();
    const s = await open(home);
    const st = await run(StreamsStore);
    await run(st.append(home, s.id, { action: "answer", body: "old", author: "a" }));
    await run(st.append(home, s.id, { action: "edit", body: "corrected whole", author: "a" }));
    expect(await run(st.body(home, s.id))).toBe("corrected whole\n");
  });

  test("edit(home, id, body) rewrites the block in place and refolds", async () => {
    const home = fresh();
    const s = await open(home);
    const st = await run(StreamsStore);
    const b = await run(st.append(home, s.id, { action: "answer", body: "typo", author: "a" }));
    const fixed = await run(st.edit(home, s.id, b.id, "fixed"));
    expect(fixed.n).toBe(1);
    expect(fixed.body).toBe("fixed");
    expect(await run(st.body(home, s.id))).toBe("fixed\n");
  });

  test("--status writing on a non-last block is refused", async () => {
    const home = fresh();
    const s = await open(home);
    const st = await run(StreamsStore);
    const first = await run(st.append(home, s.id, { action: "answer", body: "one", author: "a" }));
    await run(st.append(home, s.id, { action: "append", body: "two", author: "a" }));
    expect(await fails(st.edit(home, s.id, first.id, "x", "writing"))).toBe("--status writing only applies to the last block");
  });

  test("empty body and unknown block are refused", async () => {
    const home = fresh();
    const s = await open(home);
    const st = await run(StreamsStore);
    expect(await fails(st.append(home, s.id, { action: "answer", body: "  ", author: "a" }))).toBe("block text is empty");
    expect(await fails(st.edit(home, s.id, "b-nope", "x"))).toContain("no block b-nope");
  });

  test("a file session is not a stream; an unknown id is unknown session", async () => {
    const home = fresh();
    // A file session: registered through the documents repo the way open() does.
    await Effect.runPromise(
      Effect.gen(function* () {
        const docs = yield* DocumentsRepo;
        return yield* docs.upsert(home, { id: "filedoc1", path: "/tmp/x.md" });
      }).pipe(Effect.provide(documentsLayer), Effect.provide(dbLayer)),
    );
    const st = await run(StreamsStore);
    expect(await fails(st.append(home, "filedoc1", { action: "answer", body: "x", author: "a" }))).toBe("filedoc1 is not a stream");
    expect(await fails(st.blocks(home, "nope"))).toBe("unknown session");
  });

  test("header reports title, owner from the first block, count and writing", async () => {
    const home = fresh();
    const s = await open(home, "T");
    const st = await run(StreamsStore);
    const h0 = await run(st.header(home, s.id));
    expect(h0).toMatchObject({ title: "T", owner: null, blocks: 0, writing: false });
    await run(st.append(home, s.id, { action: "answer", body: "x", author: "pi", status: "writing" }));
    const h1 = await run(st.header(home, s.id));
    expect(h1).toMatchObject({ title: "T", owner: "pi", blocks: 1, writing: true });
    await run(st.setTitle(home, s.id, "Renamed"));
    expect((await run(st.header(home, s.id))).title).toBe("Renamed");
  });

  test("export reproduces the old section-per-block markdown", async () => {
    const home = fresh();
    const s = await open(home, "Log");
    const st = await run(StreamsStore);
    await run(st.append(home, s.id, { action: "answer", body: "hello", author: "agent" }));
    const md = await run(st.export(home, s.id));
    expect(md).toContain("# Log");
    expect(md).toContain("## 1. 长答 · agent · ");
    expect(md).toContain("hello");
  });
});

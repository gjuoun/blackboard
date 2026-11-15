import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Result } from "effect";
import type { AppServices } from "../effect/layers";
import { runtime } from "../effect/runtime";
import { SessionsStore } from "../sessions";
import * as streamsCli from "./streams";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-cli-streams-")));

const run = <A>(effect: Effect.Effect<A, { message: string }, AppServices>): Promise<A> => runtime.runPromise(effect);

/** A run that answers the failure's message instead of throwing. */
const fails = async <A>(effect: Effect.Effect<A, { message: string }, AppServices>): Promise<string> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const failure = Cause.findError(exit.cause);
  if (Result.isSuccess(failure)) return failure.success.message;
  throw Cause.squash(exit.cause);
};

/** A file session in the same home, through the store. */
const openFile = (home: string, path: string) =>
  run(Effect.gen(function* () {
    const store = yield* SessionsStore;
    return yield* store.open(home, path);
  }));

describe("stream cli (local lane)", () => {
  test("create → append → edit → header → export", async () => {
    const home = fresh();
    const { session, url } = await run(streamsCli.stream(home, "Log"));
    expect(session.id).toMatch(/^s-/);
    expect(url).toContain(`/s/${session.id}`);

    const b = await run(streamsCli.appendBlock(home, session.id, { action: "answer", text: "first", author: "agent" }));
    expect(b).toMatchObject({ n: 1, session: session.id });
    expect(b.url).toContain(`#${b.id}`);

    const b2 = await run(streamsCli.appendBlock(home, session.id, { action: "append", text: "second", author: "jun", status: "writing" }));
    expect(b2.n).toBe(2);

    const fixed = await run(streamsCli.editBlock(home, session.id, b.id, "first-fixed"));
    expect(fixed.n).toBe(1);

    const h = await run(streamsCli.header(home, session.id, {}));
    expect(h).toMatchObject({ id: session.id, title: "Log", owner: "agent", blocks: 2, writing: true });
    expect(streamsCli.formatHeader(h)).toContain("2 blocks  writing");

    const md = await run(streamsCli.exportBlocks(home, session.id));
    expect(md).toContain("# Log");
    expect(md).toContain("first-fixed");
    expect(md).toContain("second");
  });

  test("a file session is not a stream", async () => {
    const home = fresh();
    const file = join(home, "doc.md");
    await import("node:fs").then((fs) => fs.writeFileSync(file, "# Doc\n"));
    const s = await openFile(home, file);
    expect(await fails(streamsCli.appendBlock(home, s.id, { action: "answer", text: "x", author: "a" }))).toContain("is not a stream");
    expect(await fails(streamsCli.header(home, s.id, {}))).toContain("is not a stream");
  });

  test("an unknown ref reports no session", async () => {
    const home = fresh();
    expect(await fails(streamsCli.appendBlock(home, "nope", { action: "answer", text: "x", author: "a" }))).toContain('no session "nope"');
  });

  test("--owner is refused; --title renames", async () => {
    const home = fresh();
    const { session } = await run(streamsCli.stream(home, "Old"));
    expect(await fails(streamsCli.header(home, session.id, { owner: "x" }))).toBe("owner is the first block's author");
    const h = await run(streamsCli.header(home, session.id, { title: "New" }));
    expect(h.title).toBe("New");
  });
});

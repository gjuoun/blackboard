import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { run } from "../test/app";
import { AgentsStore, type BindInput } from "./agents-store";
import { DocumentsRepo } from "./db/repos/documents";

/** The store as the app runs it. Every test here is one process. */
const withStore = <A>(work: (store: AgentsStore["Service"]) => Effect.Effect<A, { message: string }>): Promise<A> =>
  run(
    Effect.gen(function* () {
      const store = yield* AgentsStore;
      return yield* work(store);
    }),
  );

/** A temp home; the agents table keys on documents, so the sessions are seeded first. */
const fixture = async (...sessions: string[]) => {
  const home = join(realpathSync(mkdtempSync(join(tmpdir(), "bb-agents-"))), "home");
  await run(Effect.gen(function* () {
    const docs = yield* DocumentsRepo;
    for (const id of sessions) yield* docs.upsert(home, { id, path: `/tmp/${id}.md` });
  }));
  return { home };
};

const bound = (session: string, url = "http://127.0.0.1:40000"): BindInput => ({
  session,
  path: `/tmp/${session}.md`,
  piSession: `pi-${session}`,
  url,
});

const bind = (home: string, input: BindInput) => withStore((s) => s.bind(home, input));
const get = (home: string, session: string) => withStore((s) => s.get(home, session));
const unbind = (home: string, session: string) => withStore((s) => s.unbind(home, session));
const touch = (home: string, session: string) => withStore((s) => s.touch(home, session));

describe("agent bindings", () => {
  test("a bind writes one record with both stamps", async () => {
    const { home } = await fixture("abc123");
    const record = await bind(home, bound("abc123"));
    expect(record.session).toBe("abc123");
    expect(record.piSession).toBe("pi-abc123");
    expect(record.url).toBe("http://127.0.0.1:40000");
    expect(record.boundAt).toBe(record.lastSeenAt);
    expect(await get(home, "abc123")).toEqual(record);
  });

  test("binding again replaces the record instead of adding one", async () => {
    const { home } = await fixture("abc123");
    await bind(home, bound("abc123"));
    await bind(home, { ...bound("abc123", "http://127.0.0.1:40001"), piSession: "pi-again" });
    const again = await get(home, "abc123");
    expect(again?.url).toBe("http://127.0.0.1:40001");
    expect(again?.piSession).toBe("pi-again");
  });

  test("two docs keep two records, and get names one of them", async () => {
    const { home } = await fixture("aaa111", "bbb222");
    await bind(home, bound("aaa111"));
    await bind(home, bound("bbb222"));
    expect((await get(home, "bbb222"))?.session).toBe("bbb222");
    expect(await get(home, "ccc333")).toBeNull();
  });

  test("touch moves lastSeenAt and leaves the rest alone", async () => {
    const { home } = await fixture("abc123");
    const first = await bind(home, bound("abc123"));
    await Bun.sleep(5);
    await touch(home, "abc123");
    const again = (await get(home, "abc123"))!;
    expect(again.boundAt).toBe(first.boundAt);
    expect(Date.parse(again.lastSeenAt)).toBeGreaterThan(Date.parse(first.lastSeenAt));
  });

  test("unbind returns the record once, then null", async () => {
    const { home } = await fixture("abc123");
    await bind(home, bound("abc123"));
    expect((await unbind(home, "abc123"))?.session).toBe("abc123");
    expect(await unbind(home, "abc123")).toBeNull();
    expect(await get(home, "abc123")).toBeNull();
  });

  test("a home without bindings answers null and takes one", async () => {
    const { home } = await fixture("abc123");
    expect(await get(home, "abc123")).toBeNull();
    await bind(home, bound("abc123"));
    expect((await get(home, "abc123"))?.session).toBe("abc123");
  });
});

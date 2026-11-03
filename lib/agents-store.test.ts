import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { runSync } from "../test/app";
import { AgentsStore, type BindInput } from "./agents-store";

/** The store as the app runs it, synchronously: every test here is one process. */
const withStore = <A>(work: (store: AgentsStore["Service"]) => Effect.Effect<A, { message: string }>): A =>
  runSync(
    Effect.gen(function* () {
      const store = yield* AgentsStore;
      return yield* work(store);
    }),
  );

const fixture = () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-agents-")));
  return { base, home: join(base, "home"), agents: join(base, "home", "agents.json") };
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

describe("agents.json", () => {
  test("a bind writes one plain record with both stamps", () => {
    const { home, agents } = fixture();
    const record = bind(home, bound("abc123"));
    expect(record.session).toBe("abc123");
    expect(record.piSession).toBe("pi-abc123");
    expect(record.url).toBe("http://127.0.0.1:40000");
    expect(record.boundAt).toBe(record.lastSeenAt);

    const file = JSON.parse(readFileSync(agents, "utf8"));
    expect(file.version).toBe(1);
    expect(file.agents).toHaveLength(1);
    expect(file.agents[0]).toEqual(record);
  });

  test("binding again replaces the record instead of adding one", () => {
    const { home, agents } = fixture();
    bind(home, bound("abc123"));
    bind(home, { ...bound("abc123", "http://127.0.0.1:40001"), piSession: "pi-again" });
    const file = JSON.parse(readFileSync(agents, "utf8"));
    expect(file.agents).toHaveLength(1);
    expect(file.agents[0].url).toBe("http://127.0.0.1:40001");
    expect(file.agents[0].piSession).toBe("pi-again");
  });

  test("two docs keep two records, and get names one of them", () => {
    const { home } = fixture();
    bind(home, bound("aaa111"));
    bind(home, bound("bbb222"));
    expect(get(home, "bbb222")?.session).toBe("bbb222");
    expect(get(home, "ccc333")).toBeNull();
  });

  test("touch moves lastSeenAt and leaves the rest alone", async () => {
    const { home } = fixture();
    const first = bind(home, bound("abc123"));
    await Bun.sleep(5);
    touch(home, "abc123");
    const again = get(home, "abc123")!;
    expect(again.boundAt).toBe(first.boundAt);
    expect(Date.parse(again.lastSeenAt)).toBeGreaterThan(Date.parse(first.lastSeenAt));
  });

  test("unbind returns the record once, then null", () => {
    const { home } = fixture();
    bind(home, bound("abc123"));
    expect(unbind(home, "abc123")?.session).toBe("abc123");
    expect(unbind(home, "abc123")).toBeNull();
    expect(get(home, "abc123")).toBeNull();
  });

  test("a home without an agents file has no bindings and takes one", () => {
    const { home } = fixture();
    expect(get(home, "abc123")).toBeNull();
    expect(bind(home, bound("abc123")).session).toBe("abc123");
  });
});

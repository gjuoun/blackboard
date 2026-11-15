import { describe, expect, test } from "bun:test";
import { utimesSync, writeFileSync } from "node:fs";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commentGeneral } from "../../lib/cli/comments";
import { LOCAL, fixture, register } from "../../test/api-fixture";
import { run } from "../../test/app";
import { app } from "../app";

/**
 * The doc preview endpoint, driven through the API app: the rendered document plus its metadata and
 * the general-comment thread under it.
 */

async function setup() {
  const { home, docs } = await fixture("bb-reading-doc-", { "design.md": "# Design\n\n## Plan\n\nLater text. More text.\n" });
  const design = join(docs, "design.md");
  const session = await register(home, design);
  return { home, design, id: session.id };
}

const get = (session: string) => app.request(`http://127.0.0.1/api/reading/doc?session=${session}`, { headers: LOCAL });

describe("GET /api/reading/doc", () => {
  test("renders the whole document and its metadata", async () => {
    const { id } = await setup();
    const res = await get(id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(id);
    expect(data.title).toBe("Design");
    expect(data.html).toContain("Design");
    expect(data.html).toContain("More text.");
    expect(data.sections).toBeGreaterThan(0);
    expect(data.replies).toEqual([]);
  });

  test("a general comment appears as a reply under the document", async () => {
    const { home, design, id } = await setup();
    await run(commentGeneral(home, design, "Please tighten this.", "jun"));
    const data = await (await get(id)).json();
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0]).toMatchObject({ author: "jun", body: "Please tighten this." });
  });

  test("an unknown session is refused", async () => {
    await setup();
    const res = await get("nosuchid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });
});

describe("GET /api/session?range= (stream)", () => {
  const HOST = { host: "127.0.0.1", "content-type": "application/json" };

  async function seed(n: number) {
    const { base } = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return { base: yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-session-range-" })) };
      }),
    );
    process.env.BLACKBOARD_HOME = join(base, "home");
    const res = await app.request("http://127.0.0.1/api/stream", { method: "POST", headers: HOST, body: JSON.stringify({ title: "Log" }) });
    const { session } = (await res.json()) as { session: { id: string } };
    for (let i = 1; i <= n; i++) {
      await app.request("http://127.0.0.1/api/block", {
        method: "POST",
        headers: HOST,
        body: JSON.stringify({ session: session.id, action: "append", body: `Exchange ${i}`, author: "agent" }),
      });
    }
    return session.id;
  }

  test("range returns a slice and the stream window meta", async () => {
    const id = await seed(5);
    const res = await app.request(`http://127.0.0.1/api/session?id=${id}&range=0:1`, { headers: { host: "127.0.0.1" } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { blocks: { n: number }[]; stream: { total: number; epoch: string; estimates: number[] }; window: { head: number[]; tail: number[] } };
    expect(data.blocks.map((b) => b.n)).toEqual([1, 2]);
    expect(data.stream.total).toBe(5);
    expect(data.stream.epoch).toMatch(/^5:\d+$/);
    expect(data.stream.estimates).toHaveLength(5);
    expect(data.window.head.length).toBeGreaterThan(0);
  });

  test("an invalid range answers 400", async () => {
    const id = await seed(2);
    expect((await app.request(`http://127.0.0.1/api/session?id=${id}&range=2:1`, { headers: { host: "127.0.0.1" } })).status).toBe(400);
  });

  test("no range returns all blocks and the same stream meta", async () => {
    const id = await seed(4);
    const res = await app.request(`http://127.0.0.1/api/session?id=${id}`, { headers: { host: "127.0.0.1" } });
    const data = (await res.json()) as { blocks: { n: number }[]; stream: { total: number } };
    expect(data.blocks).toHaveLength(4);
    expect(data.stream.total).toBe(4);
  });
});

describe("a file session picks up later edits", () => {
  test("GET /api/session serves the edited body on the next fetch", async () => {
    const { home, docs } = await fixture("bb-doc-fresh-", { "design.md": "# Design\n\nFirst version.\n" });
    const design = join(docs, "design.md");
    const { id } = await register(home, design);
    const fetchBody = async () =>
      (await (await app.request(`http://127.0.0.1/api/session?id=${id}`, { headers: LOCAL })).json()) as { body: string | null };
    expect((await fetchBody()).body).toContain("First version.");
    writeFileSync(design, "# Design\n\nSecond version with more words.\n");
    utimesSync(design, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect((await fetchBody()).body).toContain("Second version with more words.");
  });
});

describe("a file session keeps the wire it had", () => {
  test("no stream field, and ?range= changes nothing", async () => {
    const { id } = await setup();
    const plain = (await (await app.request(`http://127.0.0.1/api/session?id=${id}`, { headers: { host: "127.0.0.1" } })).json()) as Record<string, unknown>;
    const ranged = (await (await app.request(`http://127.0.0.1/api/session?id=${id}&range=0:0`, { headers: { host: "127.0.0.1" } })).json()) as Record<string, unknown>;
    // A markdown doc has no exchanges and no window: the two answers are byte-identical.
    expect("stream" in plain).toBe(false);
    expect("window" in plain).toBe(false);
    expect(JSON.stringify(ranged)).toBe(JSON.stringify(plain));
  });
});

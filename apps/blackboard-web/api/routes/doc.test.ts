import { describe, expect, test } from "bun:test";
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commentGeneral } from "../../lib/cli/comments";
import { fixture, LOCAL, register } from "../../test/api-fixture";
import { run, services } from "../../test/app";
import { app } from "../app";

/**
 * The doc preview endpoint, driven through the API app: the rendered document plus its metadata and
 * the general-comment thread under it.
 */

async function setup() {
  const { home, docs } = await fixture("bb-reading-doc-", {
    "design.md": "# Design\n\n## Plan\n\nLater text. More text.\n",
  });
  const design = join(docs, "design.md");
  const session = await register(home, design);
  return { home, design, id: session.id };
}

const get = (session: string) =>
  app.request(`http://127.0.0.1/api/reading/doc?session=${session}`, { headers: LOCAL });

describe("GET /api/reading/doc", () => {
  test("renders the whole document and its metadata", async () => {
    const { id } = await setup();
    const res = await get(id);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(id);
    expect(data.title).toBe("Design");
    expect(data.html).toContain("Design");
    expect(data.html).toContain("More text.");
    expect(data.sections).toBeGreaterThan(0);
    expect(data.replies).toEqual([]);
  });

  test("a general comment appears as a reply under the document", async () => {
    const { home, design, id } = await setup();
    await run(
      commentGeneral(services.sessions, services.comments, home, design, "Please tighten this.", "jun"),
    );
    const { data } = await (await get(id)).json();
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0]).toMatchObject({ author: "jun", body: "Please tighten this." });
  });

  test("an unknown session is refused", async () => {
    await setup();
    const res = await get("nosuchid");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: { message: "unknown session" } });
  });
});

describe("a file session picks up later edits", () => {
  test("GET /api/session serves the edited body on the next fetch", async () => {
    const { home, docs } = await fixture("bb-doc-fresh-", { "design.md": "# Design\n\nFirst version.\n" });
    const design = join(docs, "design.md");
    const { id } = await register(home, design);
    const fetchBody = async () =>
      (await (await app.request(`http://127.0.0.1/api/session?id=${id}`, { headers: LOCAL })).json())
        .data as {
        body: string | null;
      };
    expect((await fetchBody()).body).toContain("First version.");
    writeFileSync(design, "# Design\n\nSecond version with more words.\n");
    utimesSync(design, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect((await fetchBody()).body).toContain("Second version with more words.");
  });
});

describe("a file session keeps the wire it had", () => {
  test("no stream field, and ?range= changes nothing", async () => {
    const { id } = await setup();
    const plain = (await (
      await app.request(`http://127.0.0.1/api/session?id=${id}`, { headers: { host: "127.0.0.1" } })
    ).json()) as Record<string, unknown>;
    const ranged = (await (
      await app.request(`http://127.0.0.1/api/session?id=${id}&range=0:0`, { headers: { host: "127.0.0.1" } })
    ).json()) as Record<string, unknown>;
    // A markdown doc has no exchanges and no window: the two answers are byte-identical.
    expect("stream" in plain).toBe(false);
    expect("window" in plain).toBe(false);
    expect(JSON.stringify(ranged)).toBe(JSON.stringify(plain));
  });
});

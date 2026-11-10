import { describe, expect, test } from "bun:test";
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

import { describe, expect, test } from "bun:test";
import { Effect, FileSystem } from "effect";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { run } from "../../../../test/app";
import { commentGeneral } from "@/lib/cli/comments";
import { open } from "@/lib/cli/sessions";
import { GET } from "./route";

/** One temp doc the preview can render. */
async function setup() {
  const { base, design } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-reading-doc-" }));
      const docs = join(base, "docs");
      yield* fs.makeDirectory(docs, { recursive: true });
      const design = join(docs, "design.md");
      yield* fs.writeFileString(design, "# Design\n\n## Plan\n\nLater text. More text.\n");
      return { base, design };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  const { session } = await run(open(home, design));
  return { home, design, id: session.id };
}

const get = (session: string) => GET(new NextRequest("http://127.0.0.1/api/reading/doc?session=" + session));

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

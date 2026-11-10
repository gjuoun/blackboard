import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { NextRequest } from "next/server";
import { run } from "../../../test/app";
import { open } from "@/lib/cli/sessions";
import { DELETE, GET, POST } from "./route";

/** A temp Blackboard home and one doc, the same fixture the comments route test builds. */
async function setup() {
  const { base, design } = await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.realPath(yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: "bb-bind-" }));
      const docs = join(base, "docs");
      yield* fs.makeDirectory(docs, { recursive: true });
      const design = join(docs, "design.md");
      yield* fs.writeFileString(design, "# Design\n\nLater text.\n");
      return { base, design };
    }),
  );
  const home = join(base, "home");
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  const { session } = await run(open(home, design));
  return { home, design, session: session.id };
}

const bind = (payload: unknown) =>
  POST(new NextRequest("http://127.0.0.1/api/bind", { method: "POST", headers: { "content-type": "application/json" }, body: typeof payload === "string" ? payload : JSON.stringify(payload) }));
const get = (session: string) => GET(new NextRequest("http://127.0.0.1/api/bind?session=" + session));
const remove = (session: string) => DELETE(new NextRequest("http://127.0.0.1/api/bind?session=" + session, { method: "DELETE" }));

describe("POST /api/bind", () => {
  test("an unknown session is refused with a plain message", async () => {
    await setup();
    const res = await bind({ session: "nosuchid", piSession: "pi-1", url: "http://127.0.0.1:40000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });

  test("a body that is not JSON is the same refusal", async () => {
    await setup();
    expect((await bind("{not json")).status).toBe(400);
  });

  test("a missing piSession is refused by name", async () => {
    const { session } = await setup();
    const res = await bind({ session, url: "http://127.0.0.1:40000" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "piSession is required" });
  });

  test("only a loopback http url is accepted", async () => {
    const { session } = await setup();
    for (const url of ["http://10.1.2.3:5000", "https://127.0.0.1:5000", "http://example.com:5000", "not a url", ""]) {
      const res = await bind({ session, piSession: "pi-1", url });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "url must be a loopback http url" });
    }
  });

  test("a bind stores the record, and binding again replaces it", async () => {
    const { design, session } = await setup();
    const res = await bind({ session, piSession: "pi-1", url: "http://127.0.0.1:40000/" });
    expect(res.status).toBe(200);
    const { binding } = await res.json();
    expect(binding.session).toBe(session);
    expect(binding.path).toBe(design);
    expect(binding.piSession).toBe("pi-1");
    expect(binding.url).toBe("http://127.0.0.1:40000");

    expect((await (await get(session)).json()).binding.piSession).toBe("pi-1");

    await bind({ session, piSession: "pi-2", url: "http://localhost:40001" });
    expect((await get(session)).status).toBe(200);
    expect((await (await get(session)).json()).binding.piSession).toBe("pi-2");
    expect((await (await get(session)).json()).binding.url).toBe("http://localhost:40001");
  });
});

describe("GET and DELETE /api/bind", () => {
  test("a session without a binding answers null, and an unknown session is a 400", async () => {
    const { session } = await setup();
    const res = await get(session);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ binding: null });
    expect((await get("nosuchid")).status).toBe(400);
  });

  test("unbind answers the id once, then null", async () => {
    const { session } = await setup();
    await bind({ session, piSession: "pi-1", url: "http://127.0.0.1:40000" });
    const first = await remove(session);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ unbound: session });
    expect(await (await remove(session)).json()).toEqual({ unbound: null });
    expect(await (await get(session)).json()).toEqual({ binding: null });
  });
});

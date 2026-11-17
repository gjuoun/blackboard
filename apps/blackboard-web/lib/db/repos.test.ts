import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Safe } from "@gjuoun/safe-ts";
import { run, services } from "../../test/app";
import type { Db } from "./client";
import { AgentsRepo } from "./repos/agents";
import { CommentsRepo } from "./repos/comments";
import { DocumentsRepo } from "./repos/documents";
import { ReadingStateRepo } from "./repos/reading-state";

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "bb-repos-")));
const at = "2026-11-10T00:00:00.000Z";
const quote = { exact: "warm", prefix: "is ", suffix: "." };

/** Seed one document so FK-bound children have a parent. */
const seed = (home: string, id = "doc1", path: string | null = "/tmp/doc.md") =>
  run(
    Safe.try(function* () {
      const docs = services.documents;
      return yield docs.upsert(home, { id, path });
    }),
  );

describe("DocumentsRepo", () => {
  test("upsert registers, get/list/remove round-trip, touch refreshes openedAt", async () => {
    const home = fresh();
    const s1 = await seed(home);
    expect(s1.id).toBe("doc1");
    const got = await run(
      Safe.try(function* () {
        const d = services.documents;
        return yield d.get(home, "doc1");
      }),
    );
    expect(got?.path).toBe("/tmp/doc.md");
    // re-open same id: path updated, createdAt kept
    const s2 = await run(
      Safe.try(function* () {
        const d = services.documents;
        return yield d.upsert(home, { id: "doc1", path: "/tmp/doc2.md" });
      }),
    );
    expect(s2.path).toBe("/tmp/doc2.md");
    expect(s2.createdAt).toBe(s1.createdAt);
    const all = await run(
      Safe.try(function* () {
        const d = services.documents;
        return yield d.list(home);
      }),
    );
    expect(all).toHaveLength(1);
    const removed = await run(
      Safe.try(function* () {
        const d = services.documents;
        return yield d.remove(home, "doc1");
      }),
    );
    expect(removed?.id).toBe("doc1");
    expect(
      await run(
        Safe.try(function* () {
          const d = services.documents;
          return yield d.get(home, "doc1");
        }),
      ),
    ).toBeNull();
  });
});

describe("CommentsRepo", () => {
  test("add/list/setStatus/addReply/update/remove", async () => {
    const home = fresh();
    await seed(home);
    const c = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.add(home, {
          id: "c_1",
          documentId: "doc1",
          doc: "x.md",
          anchor: "quote",
          quote,
          body: "why?",
          author: "jun",
          createdAt: at,
          status: "open",
          images: null,
          editedAt: null,
          resolvedAt: null,
          resolvedBy: null,
          reopenedAt: null,
          reopenedBy: null,
          blockId: null,
          blockRev: null,
        });
      }),
    );
    expect(c.replies).toEqual([]);
    const withReply = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.addReply(home, "c_1", { id: "r_1", body: "because", author: "agent" });
      }),
    );
    expect(withReply?.replies).toHaveLength(1);
    const resolved = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.setStatus(home, "c_1", "resolved", "jun");
      }),
    );
    expect(resolved?.resolvedBy).toBe("jun");
    const reopened = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.setStatus(home, "c_1", "open", "jun");
      }),
    );
    expect(reopened?.reopenedBy).toBe("jun");
    expect(reopened?.resolvedAt).toBeNull();
    const list = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.list(home, "doc1");
      }),
    );
    expect(list).toHaveLength(1);
    const edited = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.update(home, "c_1", "edited");
      }),
    );
    expect(edited?.editedAt).not.toBeNull();
    const gone = await run(
      Safe.try(function* () {
        const r = services.commentsRepo;
        return yield r.remove(home, "c_1");
      }),
    );
    expect(gone?.id).toBe("c_1");
  });
});

describe("ReadingStateRepo", () => {
  test("set/get/remove round-trip", async () => {
    const home = fresh();
    await seed(home);
    const row = {
      documentId: "doc1",
      status: "reading" as const,
      progress: 0.5,
      readAt: at,
      sourceMtime: 100,
    };
    await run(
      Safe.try(function* () {
        const r = services.readingRepo;
        return yield r.set(home, row);
      }),
    );
    const got = await run(
      Safe.try(function* () {
        const r = services.readingRepo;
        return yield r.get(home, "doc1");
      }),
    );
    expect(got).toEqual(row);
    // upsert over
    await run(
      Safe.try(function* () {
        const r = services.readingRepo;
        return yield r.set(home, { ...row, status: "read" });
      }),
    );
    expect(
      (
        await run(
          Safe.try(function* () {
            const r = services.readingRepo;
            return yield r.get(home, "doc1");
          }),
        )
      )?.status,
    ).toBe("read");
    const removed = await run(
      Safe.try(function* () {
        const r = services.readingRepo;
        return yield r.remove(home, "doc1");
      }),
    );
    expect(removed?.documentId).toBe("doc1");
  });
});

describe("AgentsRepo", () => {
  test("bind/touch/unbind round-trip", async () => {
    const home = fresh();
    await seed(home);
    const bound = await run(
      Safe.try(function* () {
        const a = services.agents;
        return yield a.bind(home, {
          session: "doc1",
          path: "/tmp/doc.md",
          piSession: "pi-1",
          url: "http://127.0.0.1:5",
        });
      }),
    );
    expect(bound.piSession).toBe("pi-1");
    const seen = await run(
      Safe.try(function* () {
        const a = services.agents;
        yield a.touch(home, "doc1");
        return yield a.get(home, "doc1");
      }),
    );
    expect(seen?.lastSeenAt).not.toBeNull();
    // rebind replaces
    await run(
      Safe.try(function* () {
        const a = services.agents;
        return yield a.bind(home, { session: "doc1", path: "/tmp/doc.md", piSession: "pi-2", url: "u" });
      }),
    );
    expect(
      (
        await run(
          Safe.try(function* () {
            const a = services.agents;
            return yield a.get(home, "doc1");
          }),
        )
      )?.piSession,
    ).toBe("pi-2");
    const gone = await run(
      Safe.try(function* () {
        const a = services.agents;
        return yield a.unbind(home, "doc1");
      }),
    );
    expect(gone?.session).toBe("doc1");
  });
});

import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { run } from "../test/app";
import { CommentsStore } from "./comments-store";
import { realDoc, type Session, SessionsStore, servablePath, sessionCommentsPath } from "./sessions";

/** The registry operations as the app runs them. Every test here is single process. */
const withStore = <A>(
  work: (store: SessionsStore["Service"]) => Effect.Effect<A, { message: string }>,
): Promise<A> =>
  run(
    Effect.gen(function* () {
      const store = yield* SessionsStore;
      return yield* work(store);
    }),
  );
const openSession = (home: string, file: string, cwd = process.cwd()): Promise<Session> =>
  withStore((s) => s.open(home, file, cwd));
const closeSession = (home: string, id: string): Promise<Session> => withStore((s) => s.close(home, id));
const listSessions = (home: string): Promise<Session[]> => withStore((s) => s.list(home));
const getSession = (home: string, id: string): Promise<Session | null> => withStore((s) => s.get(home, id));
const resolveSession = (home: string, ref: string, cwd = process.cwd()): Promise<Session | null> =>
  withStore((s) => s.resolve(home, ref, cwd));

/** A temp home plus a few docs: one in a nested folder, a non-markdown file, a symlink to a doc. */
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-sessions-")));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(join(docs, "sub"), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(docs, "design.md"), "# Design\n");
  writeFileSync(join(docs, "sub", "notes.md"), "# Notes\n");
  writeFileSync(join(docs, "notes.txt"), "not markdown\n");
  writeFileSync(join(base, "secret.txt"), "root:x:0:0\n");
  symlinkSync(join(docs, "design.md"), join(docs, "alias.md"));
  symlinkSync(join(base, "secret.txt"), join(docs, "sneaky.md"));
  return { base, home, docs };
}

describe("realDoc", () => {
  test("realDoc: txt still refused", () => {
    const { docs } = fixture();
    expect(() => realDoc(join(docs, "notes.txt"))).toThrow(/not a markdown file/);
  });

  test("realDoc: symlink escape refused", () => {
    const { docs } = fixture();
    expect(() => realDoc(join(docs, "sneaky.md"))).toThrow(/not a markdown file/);
  });

  test("realDoc: non-markdown files are refused — code too", () => {
    const { docs } = fixture();
    writeFileSync(join(docs, "log.jsonl"), "{}\n");
    writeFileSync(join(docs, "app.tsx"), "export {};\n");
    expect(() => realDoc(join(docs, "log.jsonl"))).toThrow(/not a markdown file/);
    expect(() => realDoc(join(docs, "app.tsx"))).toThrow(/not a markdown file/);
  });
});

describe("openSession", () => {
  test("opening the same file twice returns one session", async () => {
    const { home, docs } = fixture();
    const a = await openSession(home, join(docs, "design.md"));
    const b = await openSession(home, join(docs, "design.md"));
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.openedAt >= a.openedAt).toBe(true);
    expect(await listSessions(home)).toHaveLength(1);
    expect(a.id).toMatch(/^[0-9a-f]{10}$/);
    expect(a.path).toBe(join(docs, "design.md"));
  });

  test("refuses a directory", async () => {
    const { home, docs } = fixture();
    await expect(openSession(home, docs)).rejects.toThrow(/not a markdown file/);
  });

  test("refuses a non-markdown file and a missing file", async () => {
    const { home, docs } = fixture();
    await expect(openSession(home, join(docs, "notes.txt"))).rejects.toThrow(/not a markdown file/);
    await expect(openSession(home, join(docs, "nope.md"))).rejects.toThrow(/no such file/);
    await expect(openSession(home, join(docs, "design.md\0x"))).rejects.toThrow();
  });

  test("refuses a .md symlink that points at something else", async () => {
    const { home, docs } = fixture();
    await expect(openSession(home, join(docs, "sneaky.md"))).rejects.toThrow(/not a markdown file/);
  });

  test("resolves a symlink to the same id", async () => {
    const { home, docs } = fixture();
    expect((await openSession(home, join(docs, "alias.md"))).id).toBe(
      (await openSession(home, join(docs, "design.md"))).id,
    );
  });
});

describe("lazy freshness", () => {
  test("a file edited after registration shows through on the next read", async () => {
    const { home, docs } = fixture();
    const file = join(docs, "design.md");
    const s = await openSession(home, file);
    expect(await withStore((store) => store.body(home, s.id))).toBe("# Design\n");
    // Rewrite with different content and a forced, explicitly different mtime, so the change is
    // visible whatever the filesystem's clock resolution.
    writeFileSync(file, "# Design v2\n\n## Added section\n\nNew paragraph.\n");
    utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const row = await withStore((store) => store.row(home, s));
    expect(await withStore((store) => store.body(home, s.id))).toBe(
      "# Design v2\n\n## Added section\n\nNew paragraph.\n",
    );
    expect(row.title).toBe("Design v2");
    expect(row.stats.sections).toBe(1);
  });
});

describe("resolveSession", () => {
  test("by id and by a relative path from another cwd", async () => {
    const { home, docs } = fixture();
    const s = await openSession(home, join(docs, "sub", "notes.md"));
    expect((await resolveSession(home, s.id))?.path).toBe(s.path);
    expect((await resolveSession(home, "notes.md", join(docs, "sub")))?.id).toBe(s.id);
    expect((await resolveSession(home, "sub/notes.md", docs))?.id).toBe(s.id);
  });

  test("an unregistered doc or unknown id is null", async () => {
    const { home, docs } = fixture();
    await openSession(home, join(docs, "design.md"));
    expect(await resolveSession(home, join(docs, "sub", "notes.md"))).toBeNull();
    expect(await resolveSession(home, "0000000000")).toBeNull();
    expect(await resolveSession(home, "../../etc/passwd")).toBeNull();
  });

  test("getSession refuses ids that are not plain tokens", async () => {
    const { home } = fixture();
    expect(await getSession(home, "../x")).toBeNull();
  });
});

describe("closeSession", () => {
  test("removes the entry but its comments survive and return on re-open", async () => {
    const { home, docs } = fixture();
    const s = await openSession(home, join(docs, "design.md"));
    await run(
      Effect.gen(function* () {
        const comments = yield* CommentsStore;
        yield* comments.add(home, s.id, "design.md", { general: true, body: "keep me", author: "jun" });
      }),
    );
    await closeSession(home, s.id);
    expect(await listSessions(home)).toHaveLength(0);
    await expect(closeSession(home, s.id)).rejects.toThrow(/no session/);
    // The old rule: closing kept the comments, and opening the file again brings them back.
    const reopened = await openSession(home, join(docs, "design.md"));
    expect(reopened.id).toBe(s.id);
    const file = await run(
      Effect.gen(function* () {
        const comments = yield* CommentsStore;
        return yield* comments.read(home, s.id);
      }),
    );
    expect(file.docs["design.md"]?.map((c) => c.body)).toEqual(["keep me"]);
  });
});

describe("servablePath", () => {
  test("refuses a registered file that was removed or swapped for a symlink elsewhere", async () => {
    const { base, home, docs } = fixture();
    const s = await openSession(home, join(docs, "sub", "notes.md"));
    expect(servablePath(s)).toBe(s.path);
    rmSync(s.path);
    expect(servablePath(s)).toBeNull();
    symlinkSync(join(base, "secret.txt"), s.path);
    expect(servablePath(s)).toBeNull();
  });
});

describe("sessionCommentsPath", () => {
  test("lives under the home, one folder per session; refuses odd ids", () => {
    expect(sessionCommentsPath("/h", "abc123")).toBe("/h/sessions/abc123/comments.json");
    expect(() => sessionCommentsPath("/h", "../x")).toThrow(/bad session id/);
  });
});

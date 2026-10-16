import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSession, getSession, listSessions, openSession, resolveSession, SCRATCHPAD_ID, scratchpadSession, sessionCommentsPath } from "./sessions";

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

describe("openSession", () => {
  test("opening the same file twice returns one session", () => {
    const { home, docs } = fixture();
    const a = openSession(home, join(docs, "design.md"));
    const b = openSession(home, join(docs, "design.md"));
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.openedAt >= a.openedAt).toBe(true);
    expect(listSessions(home)).toHaveLength(1);
    expect(a.id).toMatch(/^[0-9a-f]{10}$/);
    expect(a.path).toBe(join(docs, "design.md"));
  });

  test("refuses a directory", () => {
    const { home, docs } = fixture();
    expect(() => openSession(home, docs)).toThrow(/not a markdown file/);
  });

  test("refuses a non-markdown file and a missing file", () => {
    const { home, docs } = fixture();
    expect(() => openSession(home, join(docs, "notes.txt"))).toThrow(/not a markdown file/);
    expect(() => openSession(home, join(docs, "nope.md"))).toThrow(/no such file/);
    expect(() => openSession(home, join(docs, "design.md\0x"))).toThrow();
  });

  test("refuses a .md symlink that points at something else", () => {
    const { home, docs } = fixture();
    expect(() => openSession(home, join(docs, "sneaky.md"))).toThrow(/not a markdown file/);
  });

  test("resolves a symlink to the same id", () => {
    const { home, docs } = fixture();
    expect(openSession(home, join(docs, "alias.md")).id).toBe(openSession(home, join(docs, "design.md")).id);
  });

  test("keeps the registry as plain JSON", () => {
    const { home, docs } = fixture();
    const s = openSession(home, join(docs, "design.md"));
    const onDisk = JSON.parse(readFileSync(join(home, "sessions.json"), "utf8"));
    expect(onDisk).toEqual({ version: 1, sessions: [s] });
  });
});

describe("resolveSession", () => {
  test("by id and by a relative path from another cwd", () => {
    const { home, docs } = fixture();
    const s = openSession(home, join(docs, "sub", "notes.md"));
    expect(resolveSession(home, s.id)?.path).toBe(s.path);
    expect(resolveSession(home, "notes.md", join(docs, "sub"))?.id).toBe(s.id);
    expect(resolveSession(home, "sub/notes.md", docs)?.id).toBe(s.id);
  });

  test("an unregistered doc or unknown id is null", () => {
    const { home, docs } = fixture();
    openSession(home, join(docs, "design.md"));
    expect(resolveSession(home, join(docs, "sub", "notes.md"))).toBeNull();
    expect(resolveSession(home, "0000000000")).toBeNull();
    expect(resolveSession(home, "../../etc/passwd")).toBeNull();
  });

  test("getSession refuses ids that are not plain tokens", () => {
    const { home } = fixture();
    expect(getSession(home, "../x")).toBeNull();
  });
});

describe("closeSession", () => {
  test("removes the entry but keeps its comment folder", () => {
    const { home, docs } = fixture();
    const s = openSession(home, join(docs, "design.md"));
    const commentsDir = join(home, "sessions", s.id);
    mkdirSync(commentsDir, { recursive: true });
    writeFileSync(join(commentsDir, "comments.json"), '{"version":1,"docs":{}}\n');
    closeSession(home, s.id);
    expect(listSessions(home)).toHaveLength(0);
    expect(existsSync(join(commentsDir, "comments.json"))).toBe(true);
    expect(() => closeSession(home, s.id)).toThrow(/no session/);
  });
});

describe("sessionCommentsPath", () => {
  test("lives under the home, one folder per session; refuses odd ids", () => {
    expect(sessionCommentsPath("/h", "abc123")).toBe("/h/sessions/abc123/comments.json");
    expect(() => sessionCommentsPath("/h", "../x")).toThrow(/bad session id/);
  });
});

describe("scratchpadSession", () => {
  test("scratchpad is created once", () => {
    const { home } = fixture();
    const a = scratchpadSession(home);
    expect(a.id).toBe(SCRATCHPAD_ID);
    expect(readFileSync(join(home, "scratchpad.md"), "utf8")).toBe("# Scratchpad\n");
    writeFileSync(join(home, "scratchpad.md"), "# Scratchpad\n\nmy notes\n");
    const b = scratchpadSession(home);
    expect(b.createdAt).toBe(a.createdAt);
    expect(readFileSync(join(home, "scratchpad.md"), "utf8")).toContain("my notes");
    expect(listSessions(home).filter((s) => s.id === SCRATCHPAD_ID)).toHaveLength(1);
  });
});

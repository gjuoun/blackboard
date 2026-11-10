import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A doc page is a server component, so outside Next its request hooks and the session lookup are
// replaced; the markdown pass, the page body and the TOC stay real and read one file on disk.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "bb-page-")));
const file = join(dir, "plan.md");
const markdown = ["# Plan", "", "## First", "", "body", "", "## Second", "", "body", ""].join("\n");
writeFileSync(file, markdown);
const session = { id: "abc", path: file, createdAt: "2026-11-02T00:00:00.000Z", openedAt: "2026-11-02T00:00:00.000Z" };
// The page reads the session registry and the comment file through getHome(); point both at the
// temp folder, so the render touches no real session. Restored when this file is done.
const HOME_BEFORE = process.env.BLACKBOARD_HOME;
process.env.BLACKBOARD_HOME = dir;
afterAll(() => {
  if (HOME_BEFORE === undefined) delete process.env.BLACKBOARD_HOME;
  else process.env.BLACKBOARD_HOME = HOME_BEFORE;
});

mock.module("next/server", () => ({ connection: async () => {} }));
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/s/abc",
}));
let streamMode: false | "small" | "many" = false;
mock.module("@/lib/session-view", () => ({
  loadSession: async () => ({
    session: streamMode
      ? { id: "s-01K", path: "", createdAt: session.createdAt, openedAt: session.openedAt, kind: "stream" }
      : session,
    // The page renders the markdown the index stored, so the stub carries the same text the file holds.
    body: markdown,
    row: {
      ...session,
      title: "Plan",
      location: streamMode ? "stream" : "plan.md",
      updatedAt: "2026-11-02T00:00:00.000Z",
      branch: null,
      detached: false,
      worktree: null,
      project: null,
      repo: null,
      missing: false,
      stats: { sections: 2 },
      open: 0,
    },
    comments: { docs: {}, reviews: [] },
    blocks: streamMode
      ? streamMode === "many"
        ? Array.from({ length: 321 }, (_, i) => ({ id: `b-m${i}`, n: i + 1, action: "append", author: "agent", body: `Exchange ${i + 1} body text.`, status: i === 320 ? "writing" : null, at: "2026-11-02T00:00:00.000Z" }))
        : [
            { id: "b-x1", n: 1, action: "answer", author: "agent", body: "First", status: null, at: "2026-11-02T00:00:00.000Z" },
            { id: "b-x2", n: 2, action: "append", author: "jun", body: "more", status: "writing", at: "2026-11-02T00:01:00.000Z" },
          ]
      : undefined,
  }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import SessionPage from "./page";

/** The page as markup, from the same props Next hands it. */
async function render(): Promise<string> {
  const props = { params: Promise.resolve({ id: "abc" }), searchParams: Promise.resolve({}) } as unknown as Parameters<typeof SessionPage>[0];
  return renderToStaticMarkup(await SessionPage(props));
}

/** The markup of the left column alone. */
function leftColumn(html: string): string {
  const at = html.indexOf('data-testid="toc-panel"');
  if (at < 0) return "";
  const rest = html.slice(at);
  return rest.slice(0, rest.indexOf("</aside>") + "</aside>".length);
}

describe("the left column", () => {
  test("is the table of contents alone: one heading, no tab strip above it", async () => {
    const column = leftColumn(await render());
    expect(column).toContain('data-testid="toc"');
    // Exactly one label in the column: the TOC's own heading.
    expect(column.match(/<h[1-6][\s>]/g) ?? []).toHaveLength(1);
    expect(column).toContain(">Contents<");
    // The strip is gone: no tab list, no tab, none of the labels it carried.
    expect(column).not.toContain('role="tablist"');
    expect(column).not.toContain('role="tab"');
    expect(column).not.toContain("left-tabs");
    expect(column).not.toContain("left-tab-");
    expect(column).not.toContain("内容");
  });

  test("still lists the doc's sections, in order", async () => {
    const column = leftColumn(await render());
    const entries = [...column.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
    expect(entries).toEqual(["plan", "first", "second"]);
  });
});

describe("a streamed doc", () => {
  test("renders the exchanges as a timeline instead of the not-found surface", async () => {
    streamMode = "small";
    const html = await render();
    expect(html).toContain("stream-block");
    expect(html).toContain('id="b-x1"');
    expect(html).toContain('id="b-x2"');
    expect(html).toContain("长答");
    expect(html).toContain("追加");
    expect(html).toContain('data-status="writing"');
    expect(html).toContain("stream · s-01K");
    expect(html).not.toContain("doc-missing");
    // The rail lists exchanges, headed Timeline.
    expect(leftColumn(html)).toContain("Timeline");
    streamMode = false;
  });

  test("a long stream renders its window plus placeholders for the rest", async () => {
    streamMode = "many";
    const html = await render();
    // The first screen ships only the head window and the tail; the other exchanges arrive
    // as pending placeholders the lazy loader fills from /api/stream-blocks.
    const loaded = (html.match(/data-testid="stream-block-(?!pending)/g) ?? []).length;
    const pending = (html.match(/data-pending=/g) ?? []).length;
    expect(loaded).toBeLessThanOrEqual(49);
    expect(loaded + pending).toBe(321);
    expect(html).toContain('id="b-m320"');
    expect(html).toContain('data-status="writing"');
    streamMode = false;
  });

  test("a short stream ships every exchange, no placeholders", async () => {
    streamMode = "small";
    const html = await render();
    expect(html.match(/data-pending=/g) ?? []).toHaveLength(0);
    streamMode = false;
  });
});

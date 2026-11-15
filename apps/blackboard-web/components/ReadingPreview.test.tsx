import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkspaceDoc } from "@/lib/reading-model";

mock.module("next/link", () => ({
  Link: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a>,
}));

import { ReadingPreview } from "./ReadingPreview";

const DOC: WorkspaceDoc = {
  id: "abc",
  title: "A plan",
  path: "/x/a.md",
  location: "repo/a.md",
  repo: "repo",
  branch: "main",
  open: 0,
  updatedAt: "2026-11-01T00:00:00Z",
  updated: "just now",
  status: "read",
  progress: 0,
};

const noop = () => {};

function render() {
  return renderToStaticMarkup(
    <ReadingPreview doc={DOC} preview={null} loading={false} error={null} resume={false} onClose={noop} onMark={noop} onProgress={noop} onReply={async () => true} />,
  );
}

describe("ReadingPreview", () => {
  test("the desktop close row is gone; the pane starts at its top edge", () => {
    const html = render();
    expect(html).not.toContain("Close preview");
    expect(html).toContain('data-testid="rw-preview-title"');
  });

  test("the phone keeps its back button and overflow menu", () => {
    const html = render();
    expect(html).toContain('data-testid="rw-back"');
    expect(html).toContain('data-testid="rw-menu-open"');
  });
});

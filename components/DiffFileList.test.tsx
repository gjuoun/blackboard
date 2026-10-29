import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffFileList } from "@/components/DiffFileList";
import { prAllHref } from "@/lib/file-refs";
import { planFile, snapshot } from "@/lib/test-diff";

const THREE = () => [planFile(), planFile({ path: "lib/other.ts" }), planFile({ path: "lib/third.ts" })];
const rows = (html: string) => [...html.matchAll(/data-file="([^"]+)"/g)].map((m) => m[1]);

describe("DiffFileList subset", () => {
  test("lists only the files it is given and keeps the snapshot order", () => {
    const index = snapshot(THREE());
    const html = renderToStaticMarkup(<DiffFileList index={index} selected={null} files={[index.files[0], index.files[2]]} />);
    expect(rows(html)).toEqual(["docs/plan.md", "lib/third.ts"]);
  });

  test("a shortened list carries one server-rendered show all link", () => {
    const index = snapshot(THREE());
    const html = renderToStaticMarkup(<DiffFileList index={index} selected={null} files={[index.files[0]]} showAllHref={prAllHref()} />);
    expect(html).toContain('data-testid="diff-show-all"');
    expect(html).toContain('href="?tab=pr&amp;all=1"');
    expect(html).toContain("show all 3 files");
  });

  test("the full list has no footer, so the link never promises files already shown", () => {
    const index = snapshot(THREE());
    const html = renderToStaticMarkup(<DiffFileList index={index} selected={null} showAllHref={null} />);
    expect(rows(html)).toHaveLength(3);
    expect(html).not.toContain("diff-show-all");
    expect(html).not.toContain("show all");
  });

  test("an empty snapshot stays a stable message instead of an empty list and a link", () => {
    const html = renderToStaticMarkup(<DiffFileList index={snapshot([])} selected={null} showAllHref={prAllHref()} />);
    expect(html).toContain("No local changes against main.");
    expect(html).not.toContain("diff-show-all");
  });
});

import type { DiffFile, DiffSnapshot } from "@/lib/diff-index";

export const ADD = (text: string, newLine: number) => ({ kind: "add" as const, text, oldLine: null, newLine });
export const DEL = (text: string, oldLine: number) => ({ kind: "del" as const, text, oldLine, newLine: null });
export const CTX = (text: string, oldLine: number, newLine: number) => ({ kind: "ctx" as const, text, oldLine, newLine });

export function planFile(over: Partial<DiffFile> = {}): DiffFile {
  return {
    path: "docs/plan.md",
    oldPath: null,
    status: "modified",
    additions: 3,
    deletions: 1,
    binary: false,
    hunks: [
      {
        header: "render()",
        oldStart: 2,
        oldLines: 3,
        newStart: 2,
        newLines: 4,
        lines: [CTX("line 2", 2, 2), DEL("old line 3", 3), ADD("line 3", 3), ADD("line 3b", 4), CTX("line 4", 4, 5)],
      },
    ],
    ...over,
  };
}

export const CONTENT = Array.from({ length: 12 }, (_, i) => "line " + (i + 1));

export function snapshot(files: DiffFile[] = [planFile()]): DiffSnapshot {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    root: "/repo",
    baseRef: "main",
    baseSha: "abc1234",
    files,
    totals: {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    },
    file: (p) => byPath.get(p),
    content: (p) => (p === "docs/plan.md" ? CONTENT : null),
  };
}

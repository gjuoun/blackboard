/**
 * Lines of a file that differ from HEAD: the uncommitted "proposed" changes shown on the File tab.
 * Parsed from one `git diff --unified=0 HEAD -- <path>` output per request. Pure over that text.
 */

export type ChangedLines = { added: Set<number>; modified: Set<number> };

/**
 * Hunk headers look like `@@ -a,b +c,d @@`. With --unified=0 every changed new-side line is in the `+c,d` range.
 * A hunk that also removes lines is a modification of the lines it adds; a hunk that only adds is an add.
 */
export function parseChangedLines(diff: string): ChangedLines {
  const added = new Set<number>();
  const modified = new Set<number>();
  for (const line of diff.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const start = Number(m[3]);
    const count = m[4] === undefined ? 1 : Number(m[4]);
    // A count of 0 means lines were deleted at that point; there is no new line to mark.
    if (count === 0) continue;
    const target = oldCount > 0 ? modified : added;
    for (let i = 0; i < count; i++) target.add(start + i);
  }
  return { added, modified };
}

/** Every line of an untracked file is new. */
export function allAdded(lineCount: number): ChangedLines {
  const added = new Set<number>();
  for (let i = 1; i <= lineCount; i++) added.add(i);
  return { added, modified: new Set() };
}

/** The unified-diff reader: git patch text in, one DiffFile per changed path out. Pure. */

export type DiffStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";
export type DiffLineKind = "add" | "del" | "ctx";
export type DiffLine = { kind: DiffLineKind; text: string; oldLine: number | null; newLine: number | null };
export type DiffHunk = { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: readonly DiffLine[] };
export type DiffFile = {
  /** Normalized repository-relative path. For a rename this is the new path. */
  path: string;
  oldPath: string | null;
  status: DiffStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: readonly DiffHunk[];
};

type MutableFile = {
  path: string;
  oldPath: string | null;
  status: DiffStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
};

/** Parse a unified diff into per-file hunks. Paths come from the +++/--- or rename headers. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: MutableFile | null = null;
  let hunk: { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] } | null = null;
  let oldNo = 0;
  let newNo = 0;
  let newPath = "";
  let oldPath = "";

  const flush = () => {
    if (!cur) return;
    const path = newPath || oldPath;
    if (path) {
      files.push({
        path,
        oldPath: oldPath && oldPath !== path ? oldPath : null,
        status: cur.status,
        additions: cur.additions,
        deletions: cur.deletions,
        binary: cur.binary,
        hunks: cur.hunks,
      });
    }
    cur = null;
    hunk = null;
    newPath = "";
    oldPath = "";
  };

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      flush();
      cur = { path: "", oldPath: null, status: "modified", additions: 0, deletions: 0, binary: false, hunks: [] };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith("@@ ")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (!m) {
        hunk = null;
        continue;
      }
      const next = {
        header: raw.replace(/^@@ [^@]*@@ ?/, "").trim(),
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [] as DiffLine[],
      };
      cur.hunks.push(next);
      hunk = next;
      oldNo = next.oldStart;
      newNo = next.newStart;
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("new file mode")) cur.status = "added";
      else if (raw.startsWith("deleted file mode")) cur.status = "deleted";
      else if (raw.startsWith("rename from ")) {
        cur.status = "renamed";
        oldPath = raw.slice("rename from ".length).trim();
      } else if (raw.startsWith("rename to ")) newPath = raw.slice("rename to ".length).trim();
      else if (raw.startsWith("Binary files ")) cur.binary = true;
      else if (raw.startsWith("--- ")) {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") oldPath = p.replace(/^a\//, "");
      } else if (raw.startsWith("+++ ")) {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") newPath = p.replace(/^b\//, "");
      }
      continue;
    }
    if (raw.startsWith("\\ No newline")) continue;
    if (raw === "") continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      hunk.lines.push({ kind: "add", text, oldLine: null, newLine: newNo });
      cur.additions += 1;
      newNo += 1;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", text, oldLine: oldNo, newLine: null });
      cur.deletions += 1;
      oldNo += 1;
    } else if (marker === " ") {
      hunk.lines.push({ kind: "ctx", text, oldLine: oldNo, newLine: newNo });
      oldNo += 1;
      newNo += 1;
    }
  }
  flush();
  return files;
}
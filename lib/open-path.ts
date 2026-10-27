import { execFile, execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { repoRoot } from "./doc-meta";
import { expandHome } from "./home";

/** Extensions that make a bare name (no `/`) read as a file. */
export const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".py", ".sh", ".yml", ".yaml", ".toml", ".go", ".rs", ".sql"];

export type PathRef = { path: string; line?: number; col?: number };

/**
 * Whether one inline code span names a file: a single token (no spaces, no URL) with a `/` or a
 * known code extension, optionally ending in `:line` or `:line:col`. Says nothing about whether the
 * file exists; resolveDocPath decides that.
 */
export function parsePathRef(text: string): PathRef | null {
  if (!text || /\s/.test(text) || text.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  const m = /^(.+?)(?::(\d+)(?::(\d+))?)?$/.exec(text);
  if (!m) return null;
  const [, path, lineText, colText] = m;
  if (path.endsWith("/")) return null;
  if (!path.includes("/") && !CODE_EXTS.some((ext) => path.endsWith(ext))) return null;
  const ref: PathRef = { path };
  if (lineText !== undefined) {
    if (Number(lineText) < 1) return null;
    ref.line = Number(lineText);
  }
  if (colText !== undefined) {
    if (Number(colText) < 1) return null;
    ref.col = Number(colText);
  }
  return ref;
}

/** The folders a doc may link into, as real paths: its own folder and its git repo root (null outside git). */
export type DocRoots = { docDir: string; repoRoot: string | null };

export function docRoots(docPath: string): DocRoots | null {
  let docDir: string;
  try {
    docDir = realpathSync(/*turbopackIgnore: true*/ dirname(docPath));
  } catch {
    return null;
  }
  return { docDir, repoRoot: repoRoot(docDir) };
}

/** Whether `real` is `root` or a path below it. Both must be real paths. */
export function within(real: string, root: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return real === root || real.startsWith(prefix);
}

/** The real path of an existing regular file, or null (missing, a folder, or a dangling link). */
export function realFile(abs: string): string | null {
  try {
    const real = realpathSync(/*turbopackIgnore: true*/ abs);
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * The folders a doc's links may land in. Its own folder and repo root are obvious; the home folder
 * joins them because a doc routinely names a sibling checkout (`~/code/org/other-repo/src/x.ts`) and
 * with worktrees the repo root is the worktree, not the checkout the reader thinks of. Nothing
 * outside home is reachable this way (`/etc/passwd` stays unlinked).
 */
export function linkRoots(roots: DocRoots): string[] {
  return [roots.docDir, roots.repoRoot, homeRoot()].filter((r): r is string => r !== null);
}

/** The real path of the home folder, or null when HOME is unset or missing. */
export function homeRoot(): string | null {
  const home = expandHome("~");
  try {
    return realpathSync(/*turbopackIgnore: true*/ home);
  } catch {
    return null;
  }
}

export function containedIn(real: string, roots: string[]): boolean {
  return roots.some((root) => within(real, root));
}

/**
 * The real path a doc's inline path points at, or null. Candidates in order: an absolute path as
 * written; `~` expanded; relative to the doc's folder, then its git repo root, then the folder's
 * parent. The first candidate that is an existing regular file decides. Its real path must sit in
 * the doc's folder or repo root; if not, there is no link, and a later candidate does not take over.
 */
export function resolveDocPath(ref: PathRef, roots: DocRoots): string | null {
  const p = expandHome(ref.path);
  const candidates = isAbsolute(p)
    ? [p]
    : [roots.docDir, roots.repoRoot, dirname(roots.docDir)].filter((b): b is string => b !== null).map((b) => resolve(b, p));
  for (const abs of candidates) {
    const real = realFile(abs);
    if (!real) continue;
    return containedIn(real, linkRoots(roots)) ? real : null;
  }
  return null;
}

/**
 * Every folder a registered doc may be opened from: each doc's folder and repo root. The open route
 * serves a file only when it realpaths inside one of these, so a crafted URL cannot open /etc/passwd.
 */
export function registeredRoots(docPaths: string[]): string[] {
  const out = new Set<string>();
  for (const doc of docPaths) {
    const roots = docRoots(doc);
    if (roots) for (const r of linkRoots(roots)) out.add(r);
  }
  return [...out];
}

/**
 * How a path link opens. Jun's default is the system default application (`open`), because the
 * reader's machine decides what edits `.ts`; a line number is the one thing `open` cannot honour, so
 * that case borrows the `code` CLI (`-g`), and BLACKBOARD_EDITOR overrides both.
 */
export type Opener = { bin: string; args: string[]; label: string };

/** Splits BLACKBOARD_EDITOR on spaces (no shell) and substitutes {path} {line} {col} in its args. */
function customOpener(file: string, line?: number, col?: number): Opener | null {
  const parts = (process.env.BLACKBOARD_EDITOR ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [bin, ...rest] = parts;
  const withPlaceholders = rest.some((a) => a.includes("{path}"));
  const at = line === undefined ? file : `${file}:${line}${col === undefined ? "" : `:${col}`}`;
  const args = withPlaceholders
    ? rest.map((a) => a.replaceAll("{path}", file).replaceAll("{line}", line === undefined ? "" : String(line)).replaceAll("{col}", col === undefined ? "" : String(col)))
    : [...rest, at];
  return { bin, args, label: process.env.BLACKBOARD_EDITOR!.trim() };
}

/** `code` on PATH, cached after the first probe. */
let codeAvailable: boolean | null = null;
function hasCodeCli(): boolean {
  if (codeAvailable === null) {
    try {
      execFileSync("code", ["--version"], { stdio: "ignore", timeout: 5_000 });
      codeAvailable = true;
    } catch {
      codeAvailable = false;
    }
  }
  return codeAvailable;
}

/** The opener a real file and an optional position resolve to: override, then `code -g`, then the default app. */
export function chooseOpener(file: string, line?: number, col?: number): Opener {
  const custom = customOpener(file, line, col);
  if (custom) return custom;
  if (line !== undefined && hasCodeCli()) {
    return { bin: "code", args: ["-g", `${file}:${line}${col === undefined ? "" : `:${col}`}`], label: "code -g (jumped to the line)" };
  }
  return { bin: process.platform === "darwin" ? "open" : "xdg-open", args: [file], label: "system default app" };
}

/** Opens one real file through the chosen opener. Rejects when it cannot be run or exits non-zero. */
export function openPath(file: string, line?: number, col?: number): Promise<Opener> {
  const opener = chooseOpener(file, line, col);
  return new Promise((ok, fail) => {
    execFile(opener.bin, opener.args, { timeout: 10_000 }, (err) => (err ? fail(err) : ok(opener)));
  });
}

import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

/**
 * The Local PR baseline a review doc carries in its own front matter:
 *
 *   ---
 *   kind: pr
 *   pr:
 *     base: main
 *     base_sha: 9675990d1e3f...
 *   ---
 *
 * The document is the source of truth. The CLI fills the block once when it is missing and
 * verifies it afterwards; the diff view pins the recorded commit instead of chasing a moving
 * merge-base, so a doc keeps showing the change it was written against.
 */

export type PrKind = "plain" | "pr";
export type PrFrontmatter = {
  /** The parsed front matter map, or null when the doc has none / it does not parse. */
  frontmatter: Record<string, unknown> | null;
  kind: PrKind;
  /** The branch label the diff is described against ("main"). */
  base: string | null;
  /** A commit hash from 7 to 40 hex characters, exactly as written. */
  baseSha: string | null;
};

/** git subprocess seam: tests inject a runner to simulate a repo without invoking git. */
export type PrGit = (cwd: string, args: string[]) => string | null;

const GIT_TIMEOUT_MS = 2000;
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const SHA = /^[0-9a-f]{7,40}$/i;
export const DEFAULT_BASE = "main";

const gitRun: PrGit = (cwd, args) => {
  try {
    return execFileSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return null;
  }
};

/** Split a leading YAML block off the source; null when there is none. */
export function splitFrontmatter(src: string): { yaml: string; body: string; match: RegExpExecArray } | null {
  const match = FRONT.exec(src);
  return match ? { yaml: match[1], body: src.slice(match[0].length), match } : null;
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The sha as written, not as YAML guessed it: an all-digit prefix would otherwise parse as a
 * number (and a leading zero would vanish), silently turning a real pin into a missing one.
 */
function writtenSha(yaml: string): string | null {
  const m = /^[ \t]+base_sha[ \t]*:[ \t]*("[^"]*"|'[^']*'|[^#\s]+)/m.exec(yaml);
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
}

/** What the doc says about itself. Anything unreadable counts as plain: the tab stays off. */
export function parsePrFrontmatter(src: string): PrFrontmatter {
  const block = splitFrontmatter(src);
  if (!block) return { frontmatter: null, kind: "plain", base: null, baseSha: null };
  let data: unknown = null;
  try {
    data = parseYaml(block.yaml);
  } catch {
    data = null;
  }
  const frontmatter = isMap(data) ? data : null;
  const pr = frontmatter && isMap(frontmatter.pr) ? frontmatter.pr : null;
  const base = typeof pr?.base === "string" && pr.base.trim() ? pr.base.trim() : null;
  const rawSha = writtenSha(block.yaml) ?? (typeof pr?.base_sha === "string" ? pr.base_sha.trim() : "");
  return {
    frontmatter,
    kind: frontmatter?.kind === "pr" ? "pr" : "plain",
    base,
    baseSha: SHA.test(rawSha) ? rawSha.toLowerCase() : null,
  };
}

const indentOf = (line: string) => /^\s*/.exec(line)![0].length;
const isKey = (line: string, key: string) => new RegExp("^" + key + "\\s*:").test(line);

/**
 * Put the pr block into the doc, touching nothing else. A line splice rather than a YAML
 * round-trip: a round-trip would requote and refold every unrelated field of an issue card.
 * Running it again with the same values returns the input byte for byte.
 */
export function fillPrFrontmatter(src: string, values: { base: string; sha: string }): string {
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const block = splitFrontmatter(src);
  if (!block) {
    const head = ["---", "kind: pr", "pr:", "  base: " + values.base, "  base_sha: " + values.sha, "---", ""];
    return head.join(eol) + eol + src;
  }

  const inner = block.yaml.split(/\r?\n/);
  const kindAt = inner.findIndex((l) => indentOf(l) === 0 && isKey(l, "kind"));
  if (kindAt >= 0) inner[kindAt] = "kind: pr";
  else inner.unshift("kind: pr");

  const prAt = inner.findIndex((l) => indentOf(l) === 0 && isKey(l, "pr"));
  if (prAt < 0) {
    inner.push("pr:", "  base: " + values.base, "  base_sha: " + values.sha);
  } else {
    // A flow-style value (pr: {}) is replaced: only the two keys below carry meaning here.
    if (/^pr\s*:\s*\S/.test(inner[prAt])) inner[prAt] = "pr:";
    let end = prAt + 1;
    while (end < inner.length && (inner[end].trim() === "" || indentOf(inner[end]) > 0)) end += 1;
    const children = inner.slice(prAt + 1, end);
    for (const key of ["base", "base_sha"] as const) {
      const value = key === "base" ? values.base : values.sha;
      const at = children.findIndex((l) => isKey(l.trim(), key));
      const line = "  " + key + ": " + value;
      if (at >= 0) children[at] = line;
      else children.push(line);
    }
    inner.splice(prAt + 1, end - prAt - 1, ...children);
  }

  return src.slice(0, block.match.index) + ["---", ...inner, "---", ""].join(eol) + eol + block.body.replace(/^\r?\n/, "");
}

/** The main branch's tip and the merge-base with HEAD, described against main; null outside a repo. */
export function resolveBase(root: string, git: PrGit = gitRun): { ref: string; sha: string } | null {
  const remote = git(root, ["rev-parse", "--verify", "--quiet", "origin/main"])?.trim();
  const local = git(root, ["rev-parse", "--verify", "--quiet", "main"])?.trim();
  if (!remote && !local) return null;
  const source = remote ? "origin/main" : "main";
  const head = git(root, ["rev-parse", "HEAD"])?.trim();
  const mergeBase = head ? git(root, ["merge-base", "HEAD", source])?.trim() : null;
  const sha = mergeBase || local || remote || "";
  return sha ? { ref: DEFAULT_BASE, sha } : null;
}

/** The full commit hash a written sha names, or null when git cannot resolve it in this repo. */
export function resolveSha(root: string, sha: string, git: PrGit = gitRun): string | null {
  return git(root, ["rev-parse", "--verify", "--quiet", sha + "^{commit}"])?.trim() || null;
}

/** One shell word, so a repo path with a space or a quote still runs verbatim. */
export const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/** The diff the front matter describes, spelled so an agent can paste it into a shell. */
export function diffCommand(root: string, sha: string): string {
  return "git -C " + shellQuote(root) + " diff --no-color --no-ext-diff --unified=3 -M " + shellQuote(sha) + " -- .";
}

export type EnsuredPrDoc =
  | { ok: true; src: string; base: string; sha: string; filled: boolean }
  | { ok: false; error: string };

/**
 * The CLI's one write path: keep a valid pin, compute a missing one from the merge-base, reject a
 * pin git cannot resolve. filled is true only when the returned source differs from the input.
 */
export function ensurePrDoc(src: string, root: string, git: PrGit = gitRun): EnsuredPrDoc {
  const doc = parsePrFrontmatter(src);
  if (doc.baseSha) {
    const full = resolveSha(root, doc.baseSha, git);
    if (!full) return { ok: false, error: 'pr.base_sha "' + doc.baseSha + '" is not a commit in ' + root };
    const base = doc.base ?? DEFAULT_BASE;
    return { ok: true, src: fillPrFrontmatter(src, { base, sha: full }), base, sha: full, filled: doc.base === null };
  }
  const resolved = resolveBase(root, git);
  if (!resolved) return { ok: false, error: "no main branch to pin: expected origin/main or main in " + root };
  const base = doc.base ?? resolved.ref;
  return { ok: true, src: fillPrFrontmatter(src, { base, sha: resolved.sha }), base, sha: resolved.sha, filled: true };
}

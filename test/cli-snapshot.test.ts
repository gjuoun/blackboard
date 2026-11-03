import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

/**
 * The CLI snapshot: the real binary, one call per subcommand and failure mode, recorded as
 * {argv, code, stdout, stderr}. The file next to this test is generated from the code and then
 * never edited by hand, so a refactor that changes what a command prints or which exit code it
 * answers fails here instead of in a shell.
 */

const SNAPSHOT = join(import.meta.dir, "cli-snapshot.json");
const BIN = new URL("../bin/blackboard.ts", import.meta.url).pathname;

type Call = { argv: string[]; code: number; stdout: string; stderr: string };

/** A temp home and a docs folder outside git. */
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-cli-snap-")));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(docs, { recursive: true });
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(join(docs, "design.md"), "# Design\n\nThe cache is warm. Later text. The cache is warm. End.\n");
  writeFileSync(join(docs, "other.md"), "# Other\n");
  writeFileSync(join(docs, "log.jsonl"), "");
  writeFileSync(join(docs, "notes.txt"), "not markdown\n");
  return { base, home, docs };
}

/**
 * Everything volatile (the temp folder, ids, git shas, clock) becomes a placeholder. A fixture that
 * happens to live under $HOME is printed there as "~/...", so that spelling of the same folder is
 * normalized too.
 */
function normalize(text: string, base: string): string {
  const under = relative(homedir(), base);
  const homes = under && !under.startsWith("..") && !isAbsolute(under) ? [base, join("~", under)] : [base];
  return homes
    .reduce((t, home) => t.split(home).join("<base>"), text)
    .replace(/\b[0-9a-f]{64}\b/g, "<sha256>")
    .replace(/\b[0-9a-f]{40}\b/g, "<sha>")
    .replace(/@ [0-9a-f]{7}\b/g, "@ <sha>")
    .replace(/\b[0-9a-f]{10}\b/g, "<id>")
    .replace(/\b[crv]_[0-9a-f]{12}\b/g, (m) => `${m.slice(0, 2)}<id>`)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<time>");
}

describe("the CLI answers the same thing after every refactor", () => {
  test("every subcommand and failure mode matches the committed snapshot", () => {
    const { base, home, docs } = fixture();
    /**
     * Nothing here may read the machine it runs on. A fresh home hides any state a real run left
     * behind, the no-browser/no-server flags stop a case from starting the app, and BLACKBOARD_URL
     * names a port nothing can be listening on (9, the discard port): "is a server up on 38770?"
     * is not a property of this product, so the snapshot must not answer it either. The ceiling
     * stops git's upward search at the fixture, so a temp folder that happens to sit inside some
     * checkout does not lend the snapshot that checkout's repo and branch.
     */
    const env = {
      ...process.env,
      BLACKBOARD_HOME: home,
      BLACKBOARD_NO_BROWSER: "1",
      BLACKBOARD_NO_SERVER: "1",
      BLACKBOARD_AUTHOR: "agent",
      BLACKBOARD_URL: "http://127.0.0.1:9",
      GIT_CEILING_DIRECTORIES: base,
    };
    const calls: { label: string; call: Call }[] = [];

    const raw = (argv: string[], cwd: string) => {
      const p = Bun.spawnSync(["bun", BIN, ...argv], { cwd, env });
      return { argv, code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
    };
    const record = (label: string, argv: string[], cwd = docs) => {
      const call = raw(argv, cwd);
      calls.push({
        label,
        call: { ...call, argv: call.argv.map((arg) => normalize(arg, base)), stdout: normalize(call.stdout, base), stderr: normalize(call.stderr, base) },
      });
      return call;
    };
    const json = (label: string, argv: string[], cwd = docs) => JSON.parse(record(label, argv, cwd).stdout);

    // sessions, before anything is registered
    record("sessions.empty", ["sessions"]);
    record("sessions.empty-json", ["sessions", "--json"]);

    // open, twice (idempotent)
    record("open.ok", ["open", "--no-browser", "--no-server", "design.md"]);
    record("open.again", ["open", "--no-browser", "--no-server", "design.md"]);
    record("open.unknown-option", ["open", "--no-browser", "--no-server", "--kind", "stream", "design.md"]);
    record("open.not-markdown", ["open", "--no-browser", "--no-server", "notes.txt"]);
    record("open.jsonl", ["open", "--no-browser", "--no-server", "log.jsonl"]);
    record("sessions.one", ["sessions"]);
    record("sessions.one-json", ["sessions", "--json"]);

    // comments: general, quote, resolve/reopen, review, close
    record("comment.general", ["comment", "design.md", "--general", "an independent note"]);
    const quoted = json("comment.quote", ["comment", "design.md", "--quote", "Later text.", "--json", "why warm?"]);
    record("comment.empty-text", ["comment", "design.md", "--quote", "Later text.", ""]);
    record("comment.no-anchor", ["comment", "design.md", "note"]);
    record("comment.bad-occurrence", ["comment", "design.md", "--quote", "Later text.", "--occurrence", "x", "note"]);
    record("comments.text", ["comments", "design.md"]);
    record("comments.json", ["comments", "design.md", "--json"]);
    record("reply.ok", ["reply", "design.md", quoted.id, "answered"]);
    record("resolve.ok", ["resolve", "design.md", quoted.id]);
    record("reopen.ok", ["reopen", "design.md", quoted.id]);
    record("reply.short-args", ["reply", quoted.id]);
    record("comments.unknown-session", ["comments", "nope"]);
    record("reply.unknown-comment", ["reply", "design.md", "c_nope", "hi"]);
    record("review.refused", ["review", "design.md", "--round", "1", "all done"]);
    record("review.ok", ["review", "design.md", "--round", "1", "all done"]);
    record("review.bad-round", ["review", "design.md", "--round", "0", "x"]);
    record("close.ok", ["close", "design.md"]);
    record("close.again", ["close", "design.md"]);

    // the binary itself
    record("serve.status", ["serve", "status"]);
    record("version", ["--version"]);
    record("unknown-command", ["frobnicate"]);

    const actual = calls.map(({ label, call }) => ({ label, ...call }));
    const body = JSON.stringify(actual, null, 2) + "\n";
    if (!existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, body);
    expect(body).toBe(readFileSync(SNAPSHOT, "utf8"));
  }, 120_000);
});
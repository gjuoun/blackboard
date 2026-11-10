#!/usr/bin/env node
/**
 * blackboard — open markdown files for review and answer their comments from a shell, for agents.
 * Works on the files under $BLACKBOARD_HOME directly; the web app need not be running.
 */

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { Cause, Effect, Exit, Result } from "effect";
import { CliError, cliFailure, formatComments, formatSessions } from "../lib/cli";
import { BlockArgs, CommentArgs, decodeArgs, HeaderArgs, MigrateArgs, ReviewArgs } from "../lib/cli/args";
import * as commentsCli from "../lib/cli/comments";
import * as dbCli from "../lib/cli/db";
import * as streamsCli from "../lib/cli/streams";
import { layer as dbLayer } from "../lib/db/client";
import { layer as lockLayer } from "../lib/lock";
import * as sessionsCli from "../lib/cli/sessions";
import type { AppServices } from "../lib/effect/layers";
import { errorMessage } from "../lib/effect/errors";
import { runtime } from "../lib/effect/runtime";
import { getHome } from "../lib/home";
import pkg from "../package.json";
import * as server from "../lib/server-ctl";

const HELP = `blackboard — review markdown files and their comments, from the shell

Usage:
  blackboard open     <file> [--no-browser]      register a file, print "<id>  <url>", open it
                                                 (starts the web app first when it is not running)
  blackboard serve    start|stop|restart|status  run the web app in the background (start --foreground: here)
  blackboard sessions [--json]                   every session: id, title, location, branch, open comments
  blackboard close    <session>                  forget a session (its comments are kept)
  blackboard comments <session> [--json]         every comment and its replies, resolved ones too
  blackboard reply    <session> <id> <text>
  blackboard resolve  <session> <comment-id>
  blackboard reopen   <session> <comment-id>
  blackboard comment  <session> --quote <passage> [--occurrence <n>] <note>
  blackboard comment  <session> --general <note>
  blackboard review   <session> --round <n> <body>
  blackboard stream   <title>                        create a streamed document, print "<id>  <url>"
  blackboard block    <session> --action answer|edit|append [--status writing] [--images a,b] <text|->
                                                 write an exchange; --edit <block-id> <text|-> rewrites a block
  blackboard header   <session> [--title <t>]        show a stream's header; --title renames it
  blackboard export   <session>                      print the stream as markdown, one section per exchange
  blackboard db       migrate [--dry-run] | stats | reindex [--force]   move the JSON stores into blackboard.db / show its contents / index the documents

<session> is a session id or a path to the registered file.
<id> is a comment id; reply also takes a reply id (the reply joins that comment's thread).

Options:
  --home <dir>     Blackboard's folder (default: $BLACKBOARD_HOME or ~/.blackboard)
  --author <name>  name on what you write (default: $BLACKBOARD_AUTHOR or "agent")
  --json           machine-readable output
  --round <n>      review: the round this verdict reports on
  --action <a>     block: answer (default), edit or append; edit carries the corrected whole document
  --status writing block: mark the exchange still open (closed by the next block)
  --edit <id>      block: rewrite an existing block's body instead of appending
  --images <list>  block: comma-separated image ids
  --title <t>      stream/header: the document title
  --no-browser     open: do not launch the browser (or set BLACKBOARD_NO_BROWSER=1)
  --dry-run        db migrate: count what would move, touch nothing
  --no-server      open: do not start the web app (or set BLACKBOARD_NO_SERVER=1)
  --port <n>       serve start / restart: port to listen on (default: from $BLACKBOARD_URL, else 38770)
  --foreground     serve start: run in this terminal until Ctrl-C
  --version        print the version

Exit codes: 0 ok, 1 command failed, 2 bad usage, 3 serve status: not running.`;


import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** True when any JSON-era store still sits in `home` as a real file (not .migrated). */
const jsonSourcesLeft = (home: string): boolean => {
  const flat = ["sessions.json", "reading-state.json", "agents.json"].some((f) => existsSync(join(home, f)));
  const comments = (() => { try { return readdirSync(join(home, "sessions")).some((d) => existsSync(join(home, "sessions", d, "comments.json"))); } catch { return false; } })();
  return flat || comments;
};

/** Run the JSON → SQLite migration when sources remain; a no-op otherwise, safe under Node. */
const migrateIfSources = (home: string): Effect.Effect<void, CliError> =>
  jsonSourcesLeft(home)
    ? dbCli.migrateCmd(home, false).pipe(Effect.provide(dbLayer), Effect.provide(lockLayer), Effect.asVoid)
    : Effect.void;

/** Best effort: a missing opener or no display must not fail the command. */
const launch = (url: string): Effect.Effect<void> =>
  Effect.try(() => {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  }).pipe(Effect.catch(() => Effect.void));

/** The web app commands answer with their own error class; every failure leaves as exit code 1. */
const serverCall = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => new CliError({ message: error instanceof server.ServerError ? error.message : errorMessage(error), code: 1 }),
  });

/**
 * open needs the web app. First use starts it in the background; a build-less clone just warns
 * (its bun dev may be the thing running), and anything else that goes wrong is a warning too:
 * registering the file still worked.
 */
const ensureServer = (home: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const r = yield* serverCall(() => server.start(home));
    if (r.started) console.error(`blackboard: started the web app at ${r.url} (stop it with: blackboard serve stop)`);
    process.env.BLACKBOARD_URL = r.url;
  }).pipe(Effect.catch((error) => Effect.sync(() => console.error(`blackboard: could not start the web app: ${error.message}`))));

const OPTIONS = {
  home: { type: "string" },
  author: { type: "string" },
  json: { type: "boolean" },
  quote: { type: "string" },
  general: { type: "boolean" },
  action: { type: "string" },
  status: { type: "string" },
  edit: { type: "string" },
  images: { type: "string" },
  title: { type: "string" },
  owner: { type: "string" },
  round: { type: "string" },
  occurrence: { type: "string" },
  "no-browser": { type: "boolean" },
  "dry-run": { type: "boolean" },
  force: { type: "boolean" },
  "no-server": { type: "boolean" },
  port: { type: "string" },
  "api-port": { type: "string" },
  foreground: { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

/** One program per invocation: the binary folds it once, at the bottom of this file. */
function main(argv: string[]): Effect.Effect<number, CliError, AppServices> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => parseArgs({ args: argv, allowPositionals: true, options: OPTIONS }),
      catch: (error) => new CliError({ message: errorMessage(error), code: 1 }),
    });
    const { values: o, positionals } = parsed;
    const [cmd, ...args] = positionals;

    if (o.version) {
      console.log(pkg.version);
      return 0;
    }
    if (o.help || !cmd) {
      console.log(HELP);
      return cmd || o.help ? 0 : 2;
    }
    const home = getHome(o.home);
    const author = (o.author ?? process.env.BLACKBOARD_AUTHOR ?? "agent").trim() || "agent";
    const need = (n: number, usage: string): Effect.Effect<void, CliError> =>
      args.length < n ? Effect.fail(new CliError({ message: `usage: blackboard ${usage}`, code: 2 })) : Effect.void;
    const print = (data: unknown, text: string) => console.log(o.json ? JSON.stringify(data, null, 2) : text);

    switch (cmd) {
      case "open": {
        yield* need(1, "open <file> [--no-browser]");
        if (!o["no-server"] && process.env.BLACKBOARD_NO_SERVER !== "1") yield* ensureServer(home);
        const opened = yield* sessionsCli.open(home, args[0], process.cwd());
        print({ ...opened.session, url: opened.url }, `${opened.session.id}  ${opened.url}`);
        if (!o["no-browser"] && process.env.BLACKBOARD_NO_BROWSER !== "1") yield* launch(opened.url);
        return 0;
      }
      case "serve": {
        const sub = args[0] ?? "status";
        if (sub === "start") {
          if (o.foreground) return yield* serverCall(() => server.runForeground(home, { port: o.port, apiPort: o["api-port"] }));
          // Move any pre-SQLite JSON stores into blackboard.db before the API answers — once,
          // idempotently. A failing migration must not leave a half-started pair behind. The cheap
          // "any sources left" check keeps a Node CLI off the bun:sqlite path entirely.
          yield* migrateIfSources(home);
          const r = yield* serverCall(() => server.start(home, { port: o.port, apiPort: o["api-port"] }));
          print(r, r.started ? `started — ${server.formatStatus(r)}` : `already ${server.formatStatus(r)}`);
          return 0;
        }
        if (sub === "stop") {
          const r = yield* serverCall(() => server.stop(home));
          print(r, r.stopped ? "stopped" : `not running${r.note ? `: ${r.note}` : ""}`);
          return 0;
        }
        if (sub === "restart") {
          yield* migrateIfSources(home);
          const r = yield* serverCall(() => server.restart(home, { port: o.port, apiPort: o["api-port"] }));
          print(r, `restarted — ${server.formatStatus(r)}`);
          return 0;
        }
        if (sub === "status") {
          const r = yield* serverCall(() => server.status(home));
          print(r, server.formatStatus(r));
          return r.running ? 0 : 3;
        }
        return yield* new CliError({ message: "usage: blackboard serve start|stop|restart|status [--port <n>] [--foreground]", code: 2 });
      }
      case "sessions": {
        const rows = yield* sessionsCli.sessions(home);
        print(rows, formatSessions(rows));
        return 0;
      }
      case "close": {
        yield* need(1, "close <session>");
        const s = yield* sessionsCli.close(home, args[0]);
        print(s, `closed ${s.id}  ${s.path}`);
        return 0;
      }
      case "comments": {
        yield* need(1, "comments <session> [--json]");
        const list = yield* commentsCli.comments(home, args[0]);
        print(list, formatComments(list));
        return 0;
      }
      case "reply": {
        yield* need(3, "reply <session> <comment-id> <text>");
        const c = yield* commentsCli.reply(home, args[0], args[1], args.slice(2).join(" "), author);
        const joined = args[1] !== c.id;
        print(c, joined ? `replied to ${args[1]} on ${c.doc}: joined thread of ${c.id}` : `replied to ${c.id} on ${c.doc}`);
        return 0;
      }
      case "resolve":
      case "reopen": {
        yield* need(2, `${cmd} <session> <comment-id>`);
        const c = yield* commentsCli.status(home, args[0], args[1], cmd === "resolve" ? "resolved" : "open", author);
        print(c, `${cmd === "resolve" ? "resolved" : "reopened"} ${c.id} on ${c.doc}`);
        return 0;
      }
      case "db": {
        const sub = args[0];
        if (sub === "migrate") {
          const opts = yield* decodeArgs(MigrateArgs, { dry: o["dry-run"] });
          // Db is provided here, not via AppLayer: the data layer is not wired into the server
          // this round, and carrying it in AppLayer would evaluate bun:sqlite under `next build`.
          const r = yield* dbCli.migrateCmd(home, opts.dry ?? false).pipe(Effect.provide(dbLayer));
          print(r, dbCli.formatReport(r));
          return 0;
        }
        if (sub === "stats") {
          const s = yield* dbCli.statsCmd(home).pipe(Effect.provide(dbLayer));
          print(s, dbCli.formatStats(s));
          return 0;
        }
        if (sub === "reindex") {
          const r = yield* dbCli.reindexCmd(home, o.force === true).pipe(Effect.provide(dbLayer), Effect.provide(lockLayer));
          print(r, dbCli.formatIndex(r));
          return 0;
        }
        return yield* dbCli.dbUsage();
      }
      case "stream": {
        yield* need(1, "stream <title>");
        const created = yield* streamsCli.stream(home, args.join(" "));
        print({ ...created.session, url: created.url }, `${created.session.id}  ${created.url}`);
        return 0;
      }
      case "block": {
        // Text is the rest of the argv, or stdin when the text is "-".
        yield* need(1, "block <session> --action answer|edit|append [--status writing] [--images a,b] <text|->");
        const opts = yield* decodeArgs(BlockArgs, { action: o.action, status: o.status, edit: o.edit, images: o.images });
        const raw = args.slice(1).join(" ");
        const text = raw === "-" ? yield* Effect.tryPromise({
          try: () => new Response(Bun.stdin.stream()).text(),
          catch: (error) => cliFailure({ message: errorMessage(error) }),
        }) : raw;
        const images = opts.images ? opts.images.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        if (opts.edit !== undefined) {
          const e = yield* streamsCli.editBlock(home, args[0], opts.edit, text, opts.status);
          print(e, `block ${e.id} rewritten in ${e.session}
${e.url}`);
          return 0;
        }
        const b = yield* streamsCli.appendBlock(home, args[0], {
          action: opts.action ?? "answer", text, author, images, status: opts.status,
        });
        print(b, `block ${b.n} (${b.id}) appended to ${b.session}
${b.url}`);
        return 0;
      }
      case "header": {
        yield* need(1, "header <session> [--title <t>]");
        const opts = yield* decodeArgs(HeaderArgs, { title: o.title, owner: o.owner });
        const h = yield* streamsCli.header(home, args[0], opts);
        print(h, streamsCli.formatHeader(h));
        return 0;
      }
      case "export": {
        yield* need(1, "export <session>");
        const md = yield* streamsCli.exportBlocks(home, args[0]);
        if (o.json) console.log(JSON.stringify({ markdown: md }));
        else process.stdout.write(md);
        return 0;
      }
      case "review": {
        yield* need(1, "review <session> --round <n> <body>");
        const opts = yield* decodeArgs(ReviewArgs, { round: o.round });
        const r = yield* commentsCli.review(home, args[0], opts.round, args.slice(1).join(" "), author);
        print(r, `review ${r.id} for round ${r.round} on ${r.doc}: ${r.verdict}`);
        return 0;
      }
      case "comment": {
        yield* need(2, "comment <session> --quote <passage> | --general <note>");
        const opts = yield* decodeArgs(CommentArgs, { general: o.general, quote: o.quote, occurrence: o.occurrence });
        const note = args.slice(1).join(" ");
        if (opts.general) {
          const c = yield* commentsCli.commentGeneral(home, args[0], note, author);
          print(c, `commented ${c.id} (general)`);
          return 0;
        }
        const c = yield* commentsCli.comment(home, args[0], opts.quote, note, author, opts.occurrence ?? 1);
        print(c, `commented ${c.id} on ${c.doc}`);
        return 0;
      }
      default:
        return yield* new CliError({ message: `unknown command "${cmd}"\n\n${HELP}`, code: 2 });
    }
  });
}

/** The one fold: a failure is printed and becomes the exit code, a defect is a crash. */
function report(cause: Cause.Cause<CliError>): number {
  const failure = Cause.findError(cause);
  if (Result.isSuccess(failure)) {
    console.error(`blackboard: ${failure.success.message}`);
    return failure.success.code;
  }
  const defect = Cause.findDefect(cause);
  console.error(`blackboard: ${errorMessage(Result.isSuccess(defect) ? defect.success : cause)}`);
  return 1;
}

/** A CLI stdout is an outbound face, so running the program here and reporting its exit is legal. */
const exit = await runtime.runPromiseExit(main(process.argv.slice(2)));
process.exitCode = Exit.isSuccess(exit) ? exit.value : report(exit.cause);
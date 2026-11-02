#!/usr/bin/env node
/**
 * blackboard — open markdown files for review and answer their comments from a shell, for agents.
 * Works on the files under $BLACKBOARD_HOME directly; the web app need not be running.
 */

import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { Cause, Effect, Exit, Result } from "effect";
import { CliError, cliFailure, formatComments, formatSessions } from "../lib/cli";
import * as commentsCli from "../lib/cli/comments";
import * as sessionsCli from "../lib/cli/sessions";
import * as streamsCli from "../lib/cli/streams";
import type { AppServices } from "../lib/effect/layers";
import { errorMessage } from "../lib/effect/errors";
import { runtime } from "../lib/effect/runtime";
import { getHome } from "../lib/home";
import type { SessionKind } from "../lib/sessions";
import pkg from "../package.json";
import * as server from "../lib/server-ctl";

const HELP = `blackboard — review markdown files and their comments, from the shell

Usage:
  blackboard open     <file> [--kind plain|stream] [--title <title>] [--no-browser]
                                                 register a file, print "<id>  <url>", open it
                                                 (starts the web app first when it is not running)
  blackboard header   <session> --title <title> [--owner <name>]
                                                 add or update a stream's metadata line (old files)
  blackboard serve    start|stop|restart|status  run the web app in the background (start --foreground: here)
  blackboard sessions [--json]                   every session: id, title, location, branch, open comments
  blackboard close    <session>                  forget a session (its comments are kept)
  blackboard comments <session> [--json]         every comment and its replies, resolved ones too
  blackboard reply    <session> <id> <text>
  blackboard resolve  <session> <comment-id>
  blackboard reopen   <session> <comment-id>
  blackboard comment  <session> --quote <passage> [--occurrence <n>] <note>
  blackboard comment  <session> --general <note>
  blackboard block    <session> --action answer|edit|append [--edit <id>] <text|->

<session> is a session id or a path to the registered file.
<id> is a comment id; reply also takes a reply id (the reply joins that comment's thread).

Options:
  --kind <k>       open: plain (default) or stream (a .jsonl block file)
  --title <t>      open --kind stream / header: the document title written into the metadata line
  --owner <name>   header: the document owner written into the metadata line
  --home <dir>     Blackboard's folder (default: $BLACKBOARD_HOME or ~/.blackboard)
  --author <name>  name on what you write (default: $BLACKBOARD_AUTHOR or "agent")
  --json           machine-readable output
  --no-browser     open: do not launch the browser (or set BLACKBOARD_NO_BROWSER=1)
  --no-server      open: do not start the web app (or set BLACKBOARD_NO_SERVER=1)
  --port <n>       serve start / restart: port to listen on (default: from $BLACKBOARD_URL, else 38770)
  --foreground     serve start: run in this terminal until Ctrl-C
  --version        print the version

Exit codes: 0 ok, 1 command failed, 2 bad usage, 3 serve status: not running.`;


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
  kind: { type: "string" },
  title: { type: "string" },
  owner: { type: "string" },
  action: { type: "string" },
  images: { type: "string" },
  status: { type: "string" },
  general: { type: "boolean" },
  round: { type: "string" },
  edit: { type: "string" },
  occurrence: { type: "string" },
  "no-browser": { type: "boolean" },
  "no-server": { type: "boolean" },
  port: { type: "string" },
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
        yield* need(1, "open <file> [--kind plain|stream] [--no-browser]");
        if (o.kind !== undefined && o.kind !== "plain" && o.kind !== "stream") {
          return yield* new CliError({ message: String.raw`--kind takes "plain" or "stream"`, code: 2 });
        }
        if (!o["no-server"] && process.env.BLACKBOARD_NO_SERVER !== "1") yield* ensureServer(home);
        const opened = yield* sessionsCli.open(home, args[0], process.cwd(), o.kind as SessionKind | undefined, o.kind === "stream" ? { title: o.title, owner: author } : undefined);
        print({ ...opened.session, url: opened.url }, `${opened.session.id}  ${opened.url}`);
        if (!o["no-browser"] && process.env.BLACKBOARD_NO_BROWSER !== "1") yield* launch(opened.url);
        return 0;
      }
      case "serve": {
        const sub = args[0] ?? "status";
        if (sub === "start") {
          if (o.foreground) return yield* serverCall(() => server.runForeground(home, { port: o.port }));
          const r = yield* serverCall(() => server.start(home, { port: o.port }));
          print(r, r.started ? `started — ${server.formatStatus(r)}` : `already ${server.formatStatus(r)}`);
          return 0;
        }
        if (sub === "stop") {
          const r = yield* serverCall(() => server.stop(home));
          print(r, r.stopped ? "stopped" : `not running${r.note ? `: ${r.note}` : ""}`);
          return 0;
        }
        if (sub === "restart") {
          yield* serverCall(() => server.stop(home));
          const r = yield* serverCall(() => server.start(home, { port: o.port }));
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
      case "header": {
        yield* need(1, "header <session> --title <title> [--owner <name>]");
        if (o.title === undefined) return yield* new CliError({ message: "header needs --title <title>", code: 2 });
        const r = yield* streamsCli.setHeader(home, args[0], { title: o.title, owner: o.owner });
        print(r, `header ${r.created ? "written" : "updated"} for ${r.file}: ${r.meta.title} (${r.meta.id}, ${r.blocks} blocks)`);
        return 0;
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
      case "block": {
        // Text is the rest of the argv, or stdin when the text is "-".
        yield* need(1, "block <session> --action answer|edit|append [--status writing] [--images a,b] <text|->");
        const action = o.action ?? "";
        const raw = args.slice(1).join(" ");
        const text = raw === "-" ? yield* Effect.tryPromise({
          try: () => new Response(Bun.stdin.stream()).text(),
          catch: (error) => cliFailure({ message: errorMessage(error) }),
        }) : raw;
        const images = o.images ? o.images.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
        if (o.status !== undefined && o.status !== "writing") return yield* new CliError({ message: String.raw`--status takes "writing"`, code: 2 });
        if (o.edit !== undefined) {
          // Changing a block keeps its id; the file is rewritten atomically.
          const e = yield* streamsCli.editBlock(home, args[0], o.edit, text);
          print(e, `block ${e.id} rewritten in ${e.file}`);
          return 0;
        }
        const b = yield* streamsCli.appendBlock(home, args[0], { action, text, author, images, status: o.status === "writing" ? "writing" : undefined });
        print(b, `block ${b.n} (${b.id}) appended to ${b.file}`);
        return 0;
      }
      case "review": {
        yield* need(1, "review <session> --round <n> <body>");
        const n = Number(o.round);
        if (!Number.isInteger(n) || n < 1) return yield* new CliError({ message: "--round must be a whole number from 1", code: 2 });
        const r = yield* commentsCli.review(home, args[0], n, args.slice(1).join(" "), author);
        print(r, `review ${r.id} for round ${r.round} on ${r.doc}: ${r.verdict}`);
        return 0;
      }
      case "export": {
        yield* need(1, "export <session>");
        const md = yield* streamsCli.exportBlocks(home, args[0]);
        if (o.json) console.log(JSON.stringify({ markdown: md }));
        else process.stdout.write(md);
        return 0;
      }
      case "comment": {
        yield* need(2, "comment <session> --quote <passage> | --general <note>");
        const note = args.slice(1).join(" ");
        if (o.general) {
          if (o.quote) return yield* new CliError({ message: "comment takes --general alone, not with --quote", code: 2 });
          const c = yield* commentsCli.commentGeneral(home, args[0], note, author);
          print(c, `commented ${c.id} (general)`);
          return 0;
        }
        if (!o.quote) return yield* new CliError({ message: "comment needs --quote <passage> or --general", code: 2 });
        const n = o.occurrence ? Number(o.occurrence) : 1;
        if (!Number.isInteger(n)) return yield* new CliError({ message: "--occurrence must be a whole number", code: 2 });
        const c = yield* commentsCli.comment(home, args[0], o.quote, note, author, n);
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
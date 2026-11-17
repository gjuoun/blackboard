#!/usr/bin/env node
/**
 * blackboard — open markdown files for review and answer their comments from a shell, for agents.
 * Works on the files under $BLACKBOARD_HOME directly; the web app need not be running.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Pipe, Runtime, Safe } from "@gjuoun/safe-ts";
import { bootstrap } from "../lib/bootstrap";
import { type CliError, formatComments, formatSessions } from "../lib/cli";
import { CommentArgs, decodeArgs, MigrateArgs } from "../lib/cli/args";
import * as blocksCli from "../lib/cli/blocks";
import * as commentsCli from "../lib/cli/comments";
import * as dbCli from "../lib/cli/db";
import * as sessionsCli from "../lib/cli/sessions";
import { errorMessage } from "../lib/errors";
import { getHome } from "../lib/home";
import * as server from "../lib/server-ctl";
import pkg from "../package.json";

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
  blackboard blocks   <session>                      list a document's content blocks
  blackboard patch    <session> --id <block> --new <text> [--old <old>]   splice one block's text
  blackboard db       migrate [--dry-run] | stats | reindex [--force]   move the JSON stores into blackboard.db / show its contents / index the documents

<session> is a session id or a path to the registered file.
<id> is a comment id; reply also takes a reply id (the reply joins that comment's thread).

Options:
  --home <dir>     Blackboard's folder (default: $BLACKBOARD_HOME or ~/.blackboard)
  --author <name>  name on what you write (default: $BLACKBOARD_AUTHOR or "agent")
  --json           machine-readable output
  --id <id>        patch: the content block to rewrite
  --new <text>     patch: the block's new text
  --old <text>     patch: the text it must still contain (refuses a stale edit)
  --title <t>      open: the document title
  --no-browser     open: do not launch the browser (or set BLACKBOARD_NO_BROWSER=1)
  --dry-run        db migrate: count what would move, touch nothing
  --no-server      open: do not start the web app (or set BLACKBOARD_NO_SERVER=1)
  --port <n>       serve start / restart: port to listen on (default: from $BLACKBOARD_URL, else 38770)
                 (the API shares it — there is no second port)
  --foreground     serve start: run in this terminal until Ctrl-C
  --version        print the version

Exit codes: 0 ok, 1 command failed, 2 bad usage, 3 serve status: not running.`;

/** Every dependency, built once for this invocation. */
const services = bootstrap();

const cliError = (message: string, code: 1 | 2 = 1): CliError => ({ CliError: { message, code } });

/** True when any JSON-era store still sits in `home` as a real file (not .migrated). */
const jsonSourcesLeft = (home: string): boolean => {
  const flat = ["sessions.json", "reading-state.json", "agents.json"].some((f) => existsSync(join(home, f)));
  const comments = () => {
    const dir = join(home, "sessions");
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((d) => existsSync(join(dir, d, "comments.json")));
  };
  return flat || comments();
};

/** Run the JSON → SQLite migration when sources remain; a no-op otherwise. */
const migrateIfSources = (home: string): Safe<void, CliError> => {
  if (!jsonSourcesLeft(home)) return Safe.ok(undefined);
  return Safe.try(function* () {
    yield dbCli.migrateCmd(services.migrations, home, false);
  }) as unknown as Safe<void, CliError>;
};

/** Best effort: a missing opener or no display must not fail the command. */
const launch = (url: string): Safe<void, never> =>
  Safe.call(
    () => {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [url], { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
    },
    () => undefined,
  ) as unknown as Safe<void, never>;

/** The web app commands answer with their own error class; every failure leaves as exit code 1. */
const serverCall = <A>(run: () => Promise<A>): Safe<A, CliError> =>
  Safe.call(
    async () => await run(),
    (error) => cliError(error instanceof server.ServerError ? error.message : errorMessage(error), 1),
  ) as unknown as Safe<A, CliError>;

/**
 * open needs the web app. First use starts it in the background; a build-less clone just warns (its
 * bun dev may be the thing running), and anything else that goes wrong is a warning too: registering
 * the file still worked.
 */
const ensureServer = (home: string): Safe<void, never> =>
  (
    Safe.try(function* () {
      const r = (yield serverCall(() => server.start(home))) as { started: boolean; url: string };
      if (r.started)
        console.error(`blackboard: started the web app at ${r.url} (stop it with: blackboard serve stop)`);
      process.env.BLACKBOARD_URL = r.url;
    }) as unknown as Safe<void, CliError>
  ).pipe(
    Pipe.catchTag("CliError", (error: { message: string }) => {
      // A clone with no build, or a port already taken: registering the file still works.
      console.error(`blackboard: could not start the web app: ${error.message}`);
      return Safe.ok(undefined);
    }),
  ) as unknown as Safe<void, never>;

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
  foreground: { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
  id: { type: "string" },
  old: { type: "string" },
  new: { type: "string" },
} as const;

/** One program per invocation: the binary folds it once, at the bottom of this file. */
function main(argv: string[]): Safe<number, CliError> {
  return Safe.try(function* () {
    const parsed = (yield Safe.call(
      () => parseArgs({ args: argv, allowPositionals: true, options: OPTIONS }),
      (error) => cliError(errorMessage(error), 1),
    )) as ReturnType<typeof parseArgs<{ args: string[]; allowPositionals: true; options: typeof OPTIONS }>>;
    const { values: o, positionals } = parsed;
    const [cmd, ...args] = positionals as string[];

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
    const need = (n: number, usage: string): Safe<void, CliError> =>
      args.length < n ? Safe.err(cliError(`usage: blackboard ${usage}`, 2)) : Safe.ok(undefined);
    const print = (data: unknown, text: string) => console.log(o.json ? JSON.stringify(data, null, 2) : text);

    switch (cmd) {
      case "open": {
        yield need(1, "open <file> [--no-browser]");
        if (!o["no-server"] && process.env.BLACKBOARD_NO_SERVER !== "1") yield ensureServer(home);
        const opened = (yield sessionsCli.open(services.sessions, home, args[0], process.cwd())) as {
          session: { id: string };
          url: string;
        };
        print({ ...opened.session, url: opened.url }, `${opened.session.id}  ${opened.url}`);
        if (!o["no-browser"] && process.env.BLACKBOARD_NO_BROWSER !== "1") yield launch(opened.url);
        return 0;
      }
      case "serve": {
        const sub = args[0] ?? "status";
        if (sub === "start") {
          if (o.foreground)
            return (yield serverCall(() => server.runForeground(home, { port: o.port }))) as number;
          // Move any pre-SQLite JSON stores into blackboard.db before the API answers — once,
          // idempotently. The cheap "any sources left" check keeps a Node CLI off the bun:sqlite path.
          yield migrateIfSources(home);
          const r = (yield serverCall(() => server.start(home, { port: o.port }))) as server.ServerStatus & {
            started: boolean;
          };
          print(r, r.started ? `started — ${server.formatStatus(r)}` : `already ${server.formatStatus(r)}`);
          return 0;
        }
        if (sub === "stop") {
          const r = (yield serverCall(() => server.stop(home))) as {
            stopped: boolean;
            note?: string;
          };
          print(r, r.stopped ? "stopped" : `not running${r.note ? `: ${r.note}` : ""}`);
          return 0;
        }
        if (sub === "restart") {
          yield migrateIfSources(home);
          const r = (yield serverCall(() => server.restart(home, { port: o.port }))) as server.ServerStatus;
          print(r, `restarted — ${server.formatStatus(r)}`);
          return 0;
        }
        if (sub === "status") {
          const r = (yield serverCall(() => server.status(home))) as server.ServerStatus;
          print(r, server.formatStatus(r));
          return r.running ? 0 : 3;
        }
        return (yield Safe.err(
          cliError("usage: blackboard serve start|stop|restart|status [--port <n>] [--foreground]", 2),
        )) as never;
      }
      case "sessions": {
        const rows = (yield sessionsCli.list(services.sessions, home)) as Parameters<
          typeof formatSessions
        >[0];
        print(rows, formatSessions(rows));
        return 0;
      }
      case "close": {
        yield need(1, "close <session>");
        const s = (yield sessionsCli.close(services.sessions, home, args[0])) as {
          id: string;
          path: string;
        };
        print(s, `closed ${s.id}  ${s.path}`);
        return 0;
      }
      case "comments": {
        yield need(1, "comments <session> [--json]");
        const list = (yield commentsCli.comments(
          services.sessions,
          services.comments,
          home,
          args[0],
        )) as Parameters<typeof formatComments>[0];
        print(list, formatComments(list));
        return 0;
      }
      case "reply": {
        yield need(3, "reply <session> <comment-id> <text>");
        const c = (yield commentsCli.reply(
          services.sessions,
          services.comments,
          home,
          args[0],
          args[1],
          args.slice(2).join(" "),
          author,
        )) as { id: string; doc: string };
        const joined = args[1] !== c.id;
        print(
          c,
          joined
            ? `replied to ${args[1]} on ${c.doc}: joined thread of ${c.id}`
            : `replied to ${c.id} on ${c.doc}`,
        );
        return 0;
      }
      case "resolve":
      case "reopen": {
        yield need(2, `${cmd} <session> <comment-id>`);
        const c = (yield commentsCli.status(
          services.sessions,
          services.comments,
          home,
          args[0],
          args[1],
          cmd === "resolve" ? "resolved" : "open",
          author,
        )) as { id: string; doc: string };
        print(c, `${cmd === "resolve" ? "resolved" : "reopened"} ${c.id} on ${c.doc}`);
        return 0;
      }
      case "db": {
        const sub = args[0];
        if (sub === "migrate") {
          const opts = (yield decodeArgs(MigrateArgs, { dry: o["dry-run"] })) as { dry?: boolean };
          const r = (yield dbCli.migrateCmd(services.migrations, home, opts.dry ?? false)) as Parameters<
            typeof dbCli.formatReport
          >[0];
          print(r, dbCli.formatReport(r));
          return 0;
        }
        if (sub === "stats") {
          const s = (yield dbCli.statsCmd(services.migrations, home)) as Parameters<
            typeof dbCli.formatStats
          >[0];
          print(s, dbCli.formatStats(s));
          return 0;
        }
        if (sub === "reindex") {
          const r = (yield dbCli.reindexCmd(services.db, home, o.force === true)) as Parameters<
            typeof dbCli.formatIndex
          >[0];
          print(r, dbCli.formatIndex(r));
          return 0;
        }
        return (yield Safe.err(dbCli.dbUsage())) as never;
      }
      case "blocks": {
        yield need(1, "blocks <session>");
        const list = (yield blocksCli.blocks(
          services.contentBlocks,
          services.sessions,
          home,
          args[0],
        )) as blocksCli.BlockLine[];
        print(
          list,
          list.length === 0
            ? "no blocks"
            : list
                .map(
                  (b) =>
                    `${b.id}  #${b.n}  ${b.kind}  rev${b.rev}  ${b.text.replace(/\s+/g, " ").slice(0, 80)}`,
                )
                .join("\n"),
        );
        return 0;
      }
      case "patch": {
        yield need(1, "patch <session> --id <block> --new <text> [--old <old>]");
        const id = o.id;
        const next = o.new;
        if (!id) return (yield Safe.err(cliError("patch needs --id <block>", 2))) as never;
        if (!next) return (yield Safe.err(cliError("patch needs --new <text>", 2))) as never;
        const r = (yield blocksCli.patch(
          services.db,
          services.contentBlocks,
          services.sessions,
          home,
          args[0],
          {
            id,
            old: o.old,
            next,
            author,
          },
        )) as { blockId: string; rev: number };
        print(r, `block ${r.blockId} → rev${r.rev}`);
        return 0;
      }
      case "comment": {
        yield need(2, "comment <session> --quote <passage> | --general <note>");
        const opts = (yield decodeArgs(CommentArgs, {
          general: o.general,
          quote: o.quote,
          occurrence: o.occurrence,
        })) as { general?: boolean; quote?: string; occurrence?: number };
        const note = args.slice(1).join(" ");
        if (opts.general) {
          const c = (yield commentsCli.commentGeneral(
            services.sessions,
            services.comments,
            home,
            args[0],
            note,
            author,
          )) as { id: string };
          print(c, `commented ${c.id} (general)`);
          return 0;
        }
        const c = (yield commentsCli.comment(
          services.sessions,
          services.comments,
          home,
          args[0],
          opts.quote ?? "",
          note,
          author,
          opts.occurrence ?? 1,
        )) as { id: string; doc: string };
        print(c, `commented ${c.id} on ${c.doc}`);
        return 0;
      }
      default:
        return (yield Safe.err(cliError(`unknown command "${cmd}"\n\n${HELP}`, 2))) as never;
    }
  }) as unknown as Safe<number, CliError>;
}

/**
 * The one fold: `Runtime.run` never throws, so the exit code is read off the outcome — a fail prints
 * its message and takes its own code, a die prints the defect and is 1.
 */
const outcome = await Runtime.run(main(process.argv.slice(2)));
if (outcome._tag === "success") {
  process.exitCode = outcome.value as number;
} else if (outcome._tag === "fail") {
  const failure = (outcome.error as CliError).CliError;
  console.error(`blackboard: ${failure.message}`);
  process.exitCode = failure.code;
} else {
  console.error(
    `blackboard: ${errorMessage(outcome._tag === "die" ? (outcome as { defect: unknown }).defect : "interrupted")}`,
  );
  process.exitCode = 1;
}

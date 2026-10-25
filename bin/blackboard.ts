#!/usr/bin/env node
/**
 * blackboard — open markdown files for review and answer their comments from a shell, for agents.
 * Works on the files under $BLACKBOARD_HOME directly; the web app need not be running.
 */
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import * as cli from "../lib/cli";
import { getHome } from "../lib/home";
import { formatImport } from "../lib/import";
import pkg from "../package.json";
import * as server from "../lib/server-ctl";

const HELP = `blackboard — review markdown files and their comments, from the shell

Usage:
  blackboard open     <file> [--no-browser]      register a .md file, print "<id>  <url>", open it
                                                 (starts the web app first when it is not running)
  blackboard serve    start|stop|restart|status  run the web app in the background (start --foreground: here)
  blackboard sessions [--json]                   every session: id, title, location, branch, open comments
  blackboard close    <session>                  forget a session (its comments are kept)
  blackboard comments <session> [--all] [--json]
  blackboard reply    <session> <comment-id> <text>
  blackboard resolve  <session> <comment-id>
  blackboard reopen   <session> <comment-id>
  blackboard comment  <session> --quote <passage> [--occurrence <n>] <note>
  blackboard import   <root> [--dry-run]         copy comments from an old folder of boards
                                                 (<root>/<board>/.blackboard/comments.json) into sessions

<session> is a session id or a path to the registered file.

Options:
  --home <dir>     Blackboard's folder (default: $BLACKBOARD_HOME or ~/.blackboard)
  --author <name>  name on what you write (default: $BLACKBOARD_AUTHOR or "agent")
  --json           machine-readable output
  --no-browser     open: do not launch the browser (or set BLACKBOARD_NO_BROWSER=1)
  --no-server      open: do not start the web app (or set BLACKBOARD_NO_SERVER=1)
  --port <n>       serve start / restart: port to listen on (default: from $BLACKBOARD_URL, else 38770)
  --foreground     serve start: run in this terminal until Ctrl-C
  --version        print the version

Exit codes: 0 ok, 1 command failed, 2 bad usage, 3 serve status: not running.`;

/**
 * `open` needs the web app. First use starts it in the background; a build-less clone just warns
 * (its `bun dev` may be the thing running), and anything else that goes wrong is a warning too:
 * registering the file still worked.
 */
async function ensureServer(home: string) {
  try {
    const r = await server.start(home);
    if (r.started) console.error(`blackboard: started the web app at ${r.url} (stop it with: blackboard serve stop)`);
    process.env.BLACKBOARD_URL = r.url;
  } catch (err) {
    console.error(`blackboard: could not start the web app: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Best effort: a missing opener or no display must not fail the command. */
function launch(url: string) {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // ignore
  }
}

async function main(argv: string[]): Promise<number> {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      home: { type: "string" },
      author: { type: "string" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      quote: { type: "string" },
      occurrence: { type: "string" },
      "no-browser": { type: "boolean" },
      "no-server": { type: "boolean" },
      port: { type: "string" },
      foreground: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
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
  const need = (n: number, usage: string) => {
    if (args.length < n) throw new cli.CliError(`usage: blackboard ${usage}`, 2);
  };
  const print = (data: unknown, text: string) => console.log(o.json ? JSON.stringify(data, null, 2) : text);

  switch (cmd) {
    case "open": {
      need(1, "open <file> [--no-browser]");
      if (!o["no-server"] && process.env.BLACKBOARD_NO_SERVER !== "1") await ensureServer(home);
      const { session, url } = cli.open(home, args[0]);
      print({ ...session, url }, `${session.id}  ${url}`);
      if (!o["no-browser"] && process.env.BLACKBOARD_NO_BROWSER !== "1") launch(url);
      return 0;
    }
    case "serve": {
      const sub = args[0] ?? "status";
      const fail = (e: unknown) => {
        throw new cli.CliError(e instanceof server.ServerError ? e.message : String(e), 1);
      };
      if (sub === "start") {
        if (o.foreground) return await server.runForeground(home, { port: o.port }).catch(fail);
        const r = await server.start(home, { port: o.port }).catch(fail);
        print(r, r.started ? `started — ${server.formatStatus(r)}` : `already ${server.formatStatus(r)}`);
        return 0;
      }
      if (sub === "stop") {
        const r = await server.stop(home);
        print(r, r.stopped ? "stopped" : `not running${r.note ? `: ${r.note}` : ""}`);
        return 0;
      }
      if (sub === "restart") {
        await server.stop(home);
        const r = await server.start(home, { port: o.port }).catch(fail);
        print(r, `restarted — ${server.formatStatus(r)}`);
        return 0;
      }
      if (sub === "status") {
        const r = await server.status(home);
        print(r, server.formatStatus(r));
        return r.running ? 0 : 3;
      }
      throw new cli.CliError("usage: blackboard serve start|stop|restart|status [--port <n>] [--foreground]", 2);
    }
    case "sessions": {
      const rows = cli.sessions(home);
      print(rows, cli.formatSessions(rows));
      return 0;
    }
    case "close": {
      need(1, "close <session>");
      const s = cli.close(home, args[0]);
      print(s, `closed ${s.id}  ${s.path}`);
      return 0;
    }
    case "comments": {
      need(1, "comments <session> [--all]");
      const list = cli.comments(home, args[0], { all: o.all });
      print(list, cli.formatComments(list));
      return 0;
    }
    case "reply": {
      need(3, "reply <session> <comment-id> <text>");
      const c = await cli.reply(home, args[0], args[1], args.slice(2).join(" "), author);
      print(c, `replied to ${c.id} on ${c.doc}`);
      return 0;
    }
    case "resolve":
    case "reopen": {
      need(2, `${cmd} <session> <comment-id>`);
      const c = await cli.status(home, args[0], args[1], cmd === "resolve" ? "resolved" : "open", author);
      print(c, `${cmd === "resolve" ? "resolved" : "reopened"} ${c.id} on ${c.doc}`);
      return 0;
    }
    case "comment": {
      need(2, "comment <session> --quote <passage> <note>");
      if (!o.quote) throw new cli.CliError("comment needs --quote <passage>", 2);
      const n = o.occurrence ? Number(o.occurrence) : 1;
      if (!Number.isInteger(n)) throw new cli.CliError("--occurrence must be a whole number", 2);
      const c = await cli.comment(home, args[0], o.quote, args.slice(1).join(" "), author, n);
      print(c, `commented ${c.id} on ${c.doc}`);
      return 0;
    }
    case "import": {
      need(1, "import <root> [--dry-run]");
      const r = await cli.importRoot(home, args[0], o["dry-run"]);
      print(r, formatImport(r, o["dry-run"]));
      return 0;
    }
    default:
      throw new cli.CliError(`unknown command "${cmd}"\n\n${HELP}`, 2);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error(`blackboard: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = err instanceof cli.CliError ? err.code : 1;
}

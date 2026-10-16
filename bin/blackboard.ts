#!/usr/bin/env bun
/**
 * blackboard — read and answer Blackboard comments from a shell, for agents.
 * Works on <board>/.blackboard/comments.json directly; the web app need not be running.
 */
import { parseArgs } from "node:util";
import * as cli from "../lib/cli";
import { getRoot } from "../lib/paths";

const HELP = `blackboard — comments on Blackboard docs, from the shell

Usage:
  blackboard boards
  blackboard comments <board> [--doc <path>] [--all] [--json]
  blackboard reply    <board> <comment-id> <text>
  blackboard resolve  <board> <comment-id>
  blackboard reopen   <board> <comment-id>
  blackboard comment  <board> <doc> --quote <passage> [--occurrence <n>] <note>
  blackboard wait     <board> [--since <iso>] [--timeout 30m]
      blocks until someone else comments, replies, edits, reopens or resolves;
      prints the events and "next: <iso>" (pass it as --since to the next wait)

Options:
  --root <dir>     folder of boards (default: $BLACKBOARD_ROOT)
  --author <name>  name on what you write (default: $BLACKBOARD_AUTHOR or "agent")
  --json           machine-readable output

Exit codes: 0 ok, 1 command failed, 2 bad usage, 3 wait timed out.`;

async function main(argv: string[]): Promise<number> {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      author: { type: "string" },
      doc: { type: "string" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      quote: { type: "string" },
      occurrence: { type: "string" },
      since: { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, ...args] = positionals;
  if (o.help || !cmd) {
    console.log(HELP);
    return cmd || o.help ? 0 : 2;
  }
  const root = getRoot(o.root);
  const author = (o.author ?? process.env.BLACKBOARD_AUTHOR ?? "agent").trim() || "agent";
  const need = (n: number, usage: string) => {
    if (args.length < n) throw new cli.CliError(`usage: blackboard ${usage}`, 2);
  };
  const print = (data: unknown, text: string) => console.log(o.json ? JSON.stringify(data, null, 2) : text);

  switch (cmd) {
    case "boards": {
      const list = cli.boards(root);
      print(list, list.map((b) => `${b.name}  (${b.docCount} docs)`).join("\n") || "no boards");
      return 0;
    }
    case "comments": {
      need(1, "comments <board> [--doc <path>] [--all]");
      const list = cli.comments(root, args[0], { doc: o.doc, all: o.all });
      print(list, cli.formatComments(list));
      return 0;
    }
    case "reply": {
      need(3, "reply <board> <comment-id> <text>");
      const c = await cli.reply(root, args[0], args[1], args.slice(2).join(" "), author);
      print(c, `replied to ${c.id} on ${c.doc}`);
      return 0;
    }
    case "resolve":
    case "reopen": {
      need(2, `${cmd} <board> <comment-id>`);
      const c = await cli.status(root, args[0], args[1], cmd === "resolve" ? "resolved" : "open", author);
      print(c, `${cmd === "resolve" ? "resolved" : "reopened"} ${c.id} on ${c.doc}`);
      return 0;
    }
    case "comment": {
      need(3, "comment <board> <doc> --quote <passage> <note>");
      if (!o.quote) throw new cli.CliError("comment needs --quote <passage>", 2);
      const n = o.occurrence ? Number(o.occurrence) : 1;
      if (!Number.isInteger(n)) throw new cli.CliError("--occurrence must be a whole number", 2);
      const c = await cli.comment(root, args[0], args[1], o.quote, args.slice(2).join(" "), author, n);
      print(c, `commented ${c.id} on ${c.doc}`);
      return 0;
    }
    case "wait": {
      need(1, "wait <board> [--since <iso>] [--timeout 30m]");
      const r = await cli.waitForActivity(root, args[0], { since: o.since, timeoutMs: cli.parseDuration(o.timeout ?? "30m"), me: author });
      print({ events: r.events, next: r.next }, r.timedOut ? `nothing new\n\nnext: ${r.next}` : cli.formatActivity(r));
      return r.timedOut ? 3 : 0;
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

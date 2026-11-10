# Contributing to Blackboard

Thanks for taking the time. Blackboard is a local markdown review app: a Next.js web app plus the
`blackboard` CLI that coding agents drive. This file is the short version of what a change needs.

## Set up

You need **Bun 1.3+** (Node 20.9+ runs the built CLI, but the repo builds and tests with Bun).

```sh
git clone https://github.com/gjuoun/blackboard.git
cd blackboard
bun install
bun dev                     # http://127.0.0.1:38770
```

`bun dev` uses `~/.blackboard` for sessions. To keep experiments away from your real data, point
`BLACKBOARD_HOME` at a throwaway folder:

```sh
BLACKBOARD_HOME=/tmp/bb-dev bun dev
```

## The four gates

Every pull request must pass all four, unpiped (a pipeline's exit status is the last command's,
so `bun test | tail` can hide a red run):

```sh
bun run typecheck     # next typegen && tsc --noEmit
bun run lint          # eslint
bun test              # unit tests
bun run build         # next build
```

CI runs the same four plus `build:server` and `build:cli`, so a green local run should be a green
PR.

## Branch and pull request

- Branch per change off `main`: `feat/<topic>`, `fix/<topic>`, `chore/<topic>` or `docs/<topic>`.
- Small, topical commits; English, conventional subjects (`feat:`, `fix:`, `chore:`, `docs:`,
  `test:`).
- Open the PR against `main`, fill in the template, and say what you verified — with the numbers
  a reviewer would check.
- One commit per logical change is welcome; a change touching code and docs can separate the two.

## Tests

Every behaviour change lands with a test in the same commit. Tests sit next to the code as
`<name>.test.ts` / `<name>.test.tsx`, assert the observable (the string written, the bytes on
disk), and never read ambient machine state — no pid, no wall clock, no status of whatever is
running.

```sh
bun test                    # whole suite
bun test lib/theme.test.ts  # one file
```

## Code style

- **`lib/` is the core** and stays framework-free: no `next/*` imports, no React, no JSX. Route
  handlers in `app/` are thin boundary adapters: decode the request, run the program, shape plain
  JSON.
- **Effect-TS for fallible IO.** No `try`/`catch` inside Effect code — `Effect.try` for impure
  calls, tagged errors plus `catchTag`, `Effect.ensuring` for cleanup. `runPromise` only at the
  edges (`lib/effect/respond.ts`, `bin/blackboard.ts`, tests).
- **Plain data crosses every outbound face** — HTTP/JSON, SSE, CLI stdout, React props. Tagged
  errors and classes are converted before they cross.
- **300 lines per file is a hard cap**; split by concept, not by line count.
- Naming: files `kebab-case.ts`, types and components `PascalCase`, values `camelCase`.

Read [AGENTS.md](AGENTS.md) for the full contract — the layering rules, the file-store discipline
and the performance red lines all live there.

## What not to commit

- Build products: `server/`, `dist/`, `.next/`, `*.tsbuildinfo`. They are gitignored; CI builds
  them.
- No secrets, tokens, internal hostnames, tracker ids or personal absolute paths — this repo is
  public.
- Screenshots and fixtures must come from a throwaway `BLACKBOARD_HOME`, never from your real
  `~/.blackboard` documents.

## Reporting bugs

Use the **Bug report** issue template. If the app is up, `blackboard serve status` prints the pid,
log file and URL — the log is the first place to look.

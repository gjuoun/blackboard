# blackboard — engineering contract

Read this before changing code. It is the repo's contract, not advice: a change that breaks a rule
below is rejected even when it works.

> Proposed home: this file becomes `AGENTS.md` (the always-loaded surface) once the maintainer
> approves it. Until then `AGENTS.md` only carries Next.js' generated block.

## What this repo is

A local web app for reviewing markdown documents, plus the `blackboard` CLI that agents drive. The
app is Next 16 (App Router) shipped as a pre-built standalone server; the CLI runs on Node or Bun.
Sessions live in `~/.blackboard`; documents stay wherever they are on disk.

## Gates — all three, unpiped, before every commit

```bash
bun run typecheck     # next typegen && tsc --noEmit
bun run lint          # eslint
bun test              # bun test, 391 tests at the time of writing
```

Never judge a gate through a pipe (`… | tail`): the pipeline's exit status is the last command's, and
a red build reads as green. Redirect to a log and check the exit code.

## Layers — one direction only

- **`app/`** — Next App Router routes and pages. A `route.ts` is a **boundary adapter**: parse the
  request, call `lib`, shape the response. No domain logic, no file parsing, no git calls.
- **`lib/`** — the core: parsing, storage, git, CLI commands. **Framework-free.** It imports no
  `next/*`, no `react`, and contains no JSX. Framework-shaped renderers live under `app/` (e.g.
  `app/_og/` for the Open Graph card).
- **`components/`** — React views. May import `lib`; `lib` never imports `components`.
- **`bin/`** — argument parsing only; every command delegates to `lib/cli.ts`.
- **`scripts/`** — build and verification tooling. Never imported by app code.

`lib/cli.ts` owns the CLI's behaviour; `bin/blackboard.ts` owns its syntax. A new subcommand is two
edits: one in each.

## Files

- **300 lines per file is a hard cap.** Split by concept, not by line count: a parser, a store and a
  renderer are three files, not one file with three sections.
- **One file, one concept.** No delegation-only wrappers, no re-export barrels that exist to shorten
  import paths.
- **Naming:** files `kebab-case.ts`, types and components `PascalCase`, values and functions
  `camelCase`, CLI subcommands `kebab-case`. One name for one thing across the repo.
- **Tests sit next to the code** as `<name>.test.ts` / `<name>.test.tsx`. Anything that only tests
  may use lives in `test/` and is never imported by `lib`, `components` or `app`.

## Plain data on the outbound faces

The repo is moving to Effect for control flow, under one boundary rule:

- **Effect lives inside the server.** It does not reach the browser: no Effect types, imports or
  runtime in anything the client bundle can reach.
- **Plain data crosses every outbound face** — HTTP/JSON responses, SSE events, CLI stdout, and the
  React props a server component hands a client component. Classes and tagged errors are converted
  to plain objects before they cross; the consumer decodes, never the producer.
- **A route handler returns plain JSON.** It runs the Effect and shapes the wire response; it never
  returns an `Effect` or a `Result` to Next.
- Sync data-plane code (reducers, lookups, value objects passed around inside an Effect) stays plain.

## No `try`/`catch`

Inside Effect code, `try`/`catch`/`try`-`finally` are banned — tests included. Use `Effect.try` for
impure fallible calls, tagged errors plus `catchTag`/`catchAll` for typed failures, `Effect.ensuring`
for cleanup, `acquireUseRelease` for resources. Assert failures with `runPromiseExit`.

Outside Effect code (build scripts, third-party adapters) an exception boundary is allowed only at
the outermost edge of a process, where it is turned into an exit code or a wire error.

## Dead code

- No unused exports, no commented-out code, no `TODO` without an issue or a card. An export that no
  other module imports either becomes module-private or is deleted.
- Deleted code is deleted, not kept behind a flag "just in case". The exception is a shipped
  feature switch (`lib/features.ts`), which is a product decision and is documented there with the
  reason it is off and what must change before it comes back.
- A feature switch does not license dead wiring: a surface that is off must not still ride in a
  server component's payload.

## Tests

Every behaviour change lands with a test in the same commit. A test asserts the observable (the
string written, the bytes on disk, the number of rows) rather than the implementation. Tests do not
start servers, open browsers or touch the network unless the card says so.

## Performance red lines (render path)

A shipped feature was reverted for feeling slower, so these are gates:

- No per-node synchronous IO inside `renderMarkdown` or any per-request render loop. Resolve paths
  once per document, or cache by content.
- Expensive plugins (KaTeX, highlight.js, mermaid) run only on content that can use them, gated by a
  cheap test on the source string.
- Every render-path change ships a measured before/after baseline: same document, same item count,
  five runs, median.

## Public repository hygiene

This repo is public and MIT licensed.

- No internal card numbers, tracker ids, private hostnames or personal absolute paths in source,
  comments, fixtures or commit messages.
- No secrets, tokens or credentials — not in code, not in tests, not in fixtures.
- Commit messages are English, conventional (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), and say
  what changed for a reader of the public history.

## Git

- Branch per change: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`. Never commit to `main`.
- Small topical commits; a change touching code and docs separates the two.
- Gates green before the push, and the PR describes what was verified, with numbers.

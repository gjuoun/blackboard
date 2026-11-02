<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# blackboard — engineering contract

Read this before changing code. It is the repo's contract, not advice: a change that breaks a rule
below is rejected even when it works.

## What this repo is

A local web app for reviewing markdown documents, plus the `blackboard` CLI that agents drive. The
app is Next 16 (App Router) shipped as a pre-built standalone server; the CLI runs on Node or Bun.
Sessions live in `~/.blackboard`; documents stay wherever they are on disk.

## Gates — all three, unpiped, before every commit

```bash
bun run typecheck     # next typegen && tsc --noEmit
bun run lint          # eslint
bun test              # bun test
```

Never judge a gate through a pipe (`… | tail`): the pipeline's exit status is the last command's, and
a red build reads as green. Redirect to a log and check the exit code.

## Layers — one direction only

- **`app/`** — Next App Router routes and pages. A `route.ts` is a **boundary adapter**: decode the
  request, run the program, shape the response. No domain logic, no file parsing, no git calls.
- **`lib/`** — the core: parsing, storage, git, CLI commands. **Framework-free.** It imports no
  `next/*`, no `react`, and contains no JSX. Framework-shaped renderers live under `app/` (e.g.
  `app/_og/` for the Open Graph card).
- **`components/`** — React views. May import `lib`; `lib` never imports `components`.
- **`bin/`** — argument parsing only; every command delegates to `lib/cli.ts`, and the process folds
  the `Effect` exactly once at the bottom into an exit code.
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

## Effect: plain data on the outbound faces

- **Effect lives inside the server.** It does not reach the browser: no Effect types, imports or
  runtime in anything the client bundle can reach.
- **Plain data crosses every outbound face** — HTTP/JSON responses, SSE events, CLI stdout, and the
  React props a server component hands a client component. Classes and tagged errors are converted
  to plain objects before they cross; the consumer decodes, never the producer.
- **A route handler returns plain JSON.** It runs the Effect and shapes the wire response; it never
  returns an `Effect` or a `Result` to Next.
- **`runPromise` / `runPromiseExit` live only at an edge**: `lib/effect/respond.ts` for routes,
  `bin/blackboard.ts` for the CLI, tests for assertions. Anywhere else is a leak.
- Sync data-plane code (reducers, lookups, value objects passed around inside an Effect) stays plain.

### Files: `FileSystem` at the edges, sync inside the stores

- **Every request and CLI edge uses `FileSystem`** from `effect`: serving an asset, storing an
  uploaded image, watching a doc folder. `FileSystem.watch` is a `Stream<WatchEvent>` whose
  watcher is released when the stream is cancelled, so a disconnected browser cannot leak one.
- **The stores keep `node:fs` sync calls on purpose.** A comment file, the session registry and a
  stream's JSONL are read, changed and written back as one synchronous step under `<file>.lock`
  (lock, temp file, rename, all inside `Effect.try`). A `FileSystem` call yields to the scheduler,
  so another writer could enter between the read and the write — still holding the lock, still
  losing the first change.
- **The render path reads metadata synchronously.** `docMeta` and `app/s/[id]/page.tsx` need a
  title, a branch and an mtime while composing JSX, once per doc. Converting them makes every
  caller async and pays an `await` per doc on first paint, for no correctness gain.
- **The CLI's process supervisor stays sync** (`lib/server-ctl.ts`): rename `modules`, open the log
  fd, spawn, record the pid — once around the spawn, not per request.

## No `try`/`catch`

Inside Effect code, `try`/`catch`/`try`-`finally` are banned — tests included. Use `Effect.try` for
impure fallible calls, tagged errors plus `catchTag`/`catchAll` for typed failures, `Effect.ensuring`
for cleanup, `acquireUseRelease` for resources. Assert failures with `runPromiseExit`.

Outside Effect code (build scripts, third-party adapters) an exception boundary is allowed only at
the outermost edge of a process, where it is turned into an exit code or a wire error.

## Dead code

- No unused exports, no commented-out code, no `TODO` without an issue or a card. An export that no
  other module imports either becomes module-private or is deleted.
- Deleted code is deleted, not kept behind a flag "just in case". A shipped feature switch lives in
  `lib/features.ts` with the reason it is off and what must change before it comes back — and a
  switch never licenses dead wiring: a surface that is off must not still ride in a payload.

## Tests

Every behaviour change lands with a test in the same commit. A test asserts the observable (the
string written, the bytes on disk, the number of rows) rather than the implementation, and it does
not read ambient machine state: no pid, no wall-clock timestamp, no `serve status` of whatever
happens to be running, no repository or branch of the checkout the suite runs in.

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

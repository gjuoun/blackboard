# blackboard — engineering contract

Read this before changing code. It is the repo's contract, not advice: a change that breaks a rule
below is rejected even when it works.

## What this repo is

A local web app for reviewing markdown documents, plus the `blackboard` CLI that agents drive. The
app is **TanStack Start on Vite 8 with Nitro** (`node-server` preset), shipped as a pre-built server.
Sessions live in `~/.blackboard`; documents stay wherever they are on disk.

The repo is a bun workspace. The app and the CLI live in `apps/blackboard-web/` — **every layer path
below is relative to that directory**. `apps/blackboard-site/` is the Astro landing page,
`packages/bb-ui` the theme and primitives, `packages/bb-tokens` the palette source.

## Gates — one command, before every commit

```bash
bun run check    # typecheck (web, bb-ui, site) → biome → bun test → bb-ui theme:check + ui-drift
```

Never judge a gate through a pipe (`… | tail`): the pipeline's exit status is the last command's, and
a red build reads as green. Redirect to a log and check the exit code. CI runs the same one step.

- **Lint and format are Biome**, from the single root `biome.json`. ESLint is gone; do not add a
  second linter. Not formatted on purpose: CSS (Biome rejects the Tailwind v4 `@theme` at-rules),
  `.astro` markup, the vendored shadcn primitives in `packages/bb-ui/src/components/ui` (ui-drift
  compares them byte for byte) and the code-generated `test/*-snapshot.json`.
- **Never run `biome check --write --unsafe`.** It rewrote `res.body!.getReader()` into
  `res.body?.getReader()` in seven test files and broke the typecheck; `noNonNullAssertion` is `off`
  for that reason.

## Layers — one direction only

- **`src/`** — TanStack Start: file routes (`src/routes/`), server functions, the forwarder, the OG
  card. `src/routes/api/$.ts` is the catch-all that mounts the Hono app in production.
- **`api/`** — the Hono app: `app.ts` (wiring), `routes/` (one module per domain), `platform/http/`
  (the envelope, `json(c, safe)`, `HttpFailure`, the guard). No file parsing, no SQL here.
- **`lib/`** — the framework-free core, shared by the API, the CLI and the UI's server functions:
  parsing, storage, git, db, CLI command bodies. Imports no `react`, no JSX, no `api/`.
- **`components/`** — React views. May import `lib`; `lib` never imports `components`.
- **`bin/`** — argument parsing only; every command delegates to `lib/cli*`, and the process folds
  the outcome exactly once at the bottom into an exit code.
- **`scripts/`** — build and verification tooling. Never imported by app code.

`lib/` must never import `api/` — a `lib` → `api` import is what makes the CLI drag the server in.
The convention test enforces this direction.

## The wire

- One envelope: `{success:true,data}` or `{success:false,error:{code,message,details?}}`. The boolean
  `success` is the discriminator; the status rides on the HTTP head and never in the body.
- `api/platform/http/http.failure.ts` is the only module that builds a failure body. `app.onError` is
  the only place a failure becomes a `Response`. A handler answers `json(c, safe)` and nothing else.
- A 5xx says `code` and `message` only: the SQLite text, the thrown value, the stack go to the log.
- `test/wire-snapshot.json` is the contract for every route and branch. A body or status change is a
  deliberate edit with `bun run test:update`, reviewed as a diff — never a regeneration to turn a red
  test green.

## Files

- **300 lines per file is a hard cap**, enforced by a convention test. Generated files
  (`lib/db/migrations/bundled.ts`) are exempt and say so in a comment.
- **One file, one concept.** No delegation-only wrappers, no re-export barrels that exist to shorten
  import paths.
- **Naming:** files `kebab-case.ts`, types and components `PascalCase`, values and functions
  `camelCase`, CLI subcommands `kebab-case`. One name for one thing across the repo. A file that is
  not generated does not get named after a library.
- **Tests sit next to the code** as `<name>.test.ts` / `<name>.test.tsx`. Anything that only tests may
  use lives in `test/` and is never imported by `lib`, `components` or `app`.

## Error handling

- **No literal `try`/`catch`** in `lib/` or `api/` — tests included. Use the effect system at the
  boundary. Outside it (build scripts, third-party adapters) an exception boundary is allowed only at
  the outermost edge of a process, where it becomes an exit code or a wire error.
- **One failure vocabulary**: `lib/errors.ts` holds the classes today; the per-domain `Errors.define`
  catalogs land with each domain's move. A failure carries its own `status` and `message`; a route
  never invents one at the call site.
- **One assembly point**: dependencies are constructed once and passed by constructor. `bootstrap()`
  is the only place that calls `new` for a service.

## Dependencies

- The web app ships **zero runtime dependencies**: everything it uses is inlined into `server/`, so
  `server/server/package.json` lists only `@resvg/resvg-js` and `tslib`. Its libraries therefore live
  in `devDependencies`, which is deliberate — do not "fix" it into `dependencies`.
- `packages/bb-ui` and the site are consumed as libraries, so their runtime imports belong in
  `dependencies`.
- A dependency the app imports but does not ship (build tooling) is `devDependencies`.

## Tests

Every behaviour change lands with a test in the same commit. A test asserts the observable (the string
written, the bytes on disk, the number of rows) rather than the implementation, and it does not read
ambient machine state: no pid of whatever happens to be running, no wall-clock lower bound, no
`serve status` of this machine. The runner's own `process.pid` as "a process that is alive" is fine.

A snapshot test never writes the file it compares against: a missing snapshot is red, and
`bun run test:update` is the only way to refresh one.

## Git

- Branch per change: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`. Never commit to `main`.
- Small topical commits; a change touching code and docs separates the two.
- Gates green before the push, and the PR describes what was verified, with numbers.

## Public repository hygiene

This repo is public and MIT licensed. No internal card numbers, tracker ids, private hostnames or
personal absolute paths in source, comments, fixtures or commit messages. No secrets, tokens or
credentials — not in code, not in tests, not in fixtures. Commit messages are English, conventional
(`feat:`, `fix:`, `chore:`, `docs:`, `test:`), and say what changed for a reader of the public history.

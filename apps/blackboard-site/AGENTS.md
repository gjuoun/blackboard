# @sites/blackboard

Landing page, English at `/` and Chinese at `/zh/`. Deployed to the `blackboard` Pages project. The review app lives in `gjuoun/blackboard`, not here.

## Stack

Astro 7, no React | tests: `bun test src` | port 4397

## Commands

```sh
bun run dev
bun run build
bun run typecheck
bun test src            # routes, locale assets, _redirects, build shape
```

## Gotchas

- `site.test.ts` builds in `beforeAll` and reads `dist/`. It asserts the build ships only pages and their assets; a new asset folder fails it.
- Port 4397 is shared with `bundant`.
- The retired `zh.html` path must not be linked from either page; `site.test.ts` asserts it.

## What

<!-- What changed, in one or two sentences for a reader of the public history. -->

## Why

<!-- The problem or issue this addresses. Link the issue if there is one. -->

## Gates

All four gates ran locally, unpiped:

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `bun run build`

## Verified

<!-- What you checked beyond the gates, with numbers where a reviewer can re-check:
     commands run, pages visited, bytes on disk. -->

## Checklist

- [ ] Behaviour changes come with a test in this PR (`<name>.test.ts` next to the code)
- [ ] No build products (`server/`, `dist/`, `.next/`) or secrets in the diff
- [ ] No functional change to files outside this PR's scope
- [ ] Docs updated when the behaviour or setup changed (README, AGENTS.md contract)

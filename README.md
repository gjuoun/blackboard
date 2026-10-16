# Blackboard

A local web app for reading a project's planning docs (markdown with mermaid diagrams) and
leaving comments on the text, so Jun and an agent can go back and forth on a plan.

Jun reads and comments in the browser; an agent reads the docs from disk and takes part in
the comments through the `blackboard` CLI (see [CLI for agents](#cli-for-agents)).

Requires [bun](https://bun.sh) 1.3+. macOS and Linux; browsers: Chrome/Edge and Safari 17.2+
(CSS Custom Highlight API).

## Run it

```sh
bun install
BLACKBOARD_ROOT=~/projects/plans bun dev   # a folder whose sub-folders are boards
# open http://127.0.0.1:38770
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `BLACKBOARD_ROOT` | (required) | Folder of boards. Every first-level folder in it is a board. |
| `PORT` | `38770` | Port for `bun dev` / `bun start`. |

The server binds `127.0.0.1` and answers only `localhost` / `127.0.0.1` / `[::1]` Host
headers; writes from another site's Origin get a 403. Every path from a URL or form is
resolved (symlinks included) and refused if it leaves `BLACKBOARD_ROOT`.

Checks: `bun run typecheck`, `bun run lint`, `bun test`, `bun run build`.

## What it does

- **Boards** — the home page lists the folders under the root. A board's file tree is every
  `*.md` in it, recursively; dot-folders and `node_modules` are skipped.
- **Doc view** — GitHub-style markdown (tables with sticky headers, heading anchors), a table of
  contents and the file tree. YAML front matter shows as a field / value table: lists as chips,
  maps as nested tables, empty values as blank cells; YAML that does not parse is shown as source. Raw HTML in a doc is not rendered.
- **Diagrams** — fenced `mermaid` blocks render in the browser from the bundled library, so
  they work offline.
- **Comments** — select text, click **Comment**, type a note. Replies are flat; comments can be
  resolved and reopened. Your own comments and replies (same author name) show **Edit** and
  **Delete** on hover; delete asks first and removes the comment with its replies.
- **Click a highlight** — the pointer changes over highlighted text; a click focuses that
  comment in the panel (scrolled to the middle, flashed). Clicking plain text clears it. Clicking
  a comment in the panel scrolls the doc to its passage. Highlights use the CSS Custom Highlight API (Chrome, Safari 17.2+).
- **Live view** — the page refreshes when a file in the board changes. Highlights follow their
  passage; a comment whose passage is gone stays in the list as *orphaned*.
- **Copy open** — copies the doc's open comments as markdown (quote, note, replies) to paste
  to an agent.
- **Old marks** — `==passage==[^n]` shows as a read-only yellow highlight with the footnote as
  a tooltip. They are not comments.
- **New board** — the home form creates `<root>/<slug>/` from [`templates/board`](templates/board).

## CLI for agents

`blackboard` reads and answers comments from a shell, so any agent with a shell (pi, Claude
Code, Codex) can take part. It edits `.blackboard/comments.json` directly under a lock shared
with the web app, so it works whether or not the app is running; an open page shows its
changes live.

```sh
bun link                       # once, from this repo: puts `blackboard` on PATH (~/.bun/bin)

blackboard boards
blackboard comments <board> [--doc design.md] [--all] [--json]   # open comments by default
blackboard reply    <board> <comment-id> "text"
blackboard resolve  <board> <comment-id>          # or: reopen
blackboard comment  <board> <doc> --quote "passage" [--occurrence 2] "note"
blackboard wait     <board> [--since <iso>] [--timeout 30m] [--json]
```

| Setting | Default | Meaning |
|---------|---------|---------|
| `--root` / `BLACKBOARD_ROOT` | (required) | Folder of boards |
| `--author` / `BLACKBOARD_AUTHOR` | `agent` | Name on what the CLI writes; `wait` ignores this author's own activity |

Exit codes: `0` ok, `1` command failed (unknown board / doc / id, quote not found), `2` bad
usage, `3` `wait` timed out with nothing new.

- `comment` finds the passage in the doc's rendered text (the same text the browser anchors
  against), so the highlight lands where the agent meant. `--occurrence` picks a repeat.
- `wait` blocks until someone else comments, replies, edits, reopens or resolves, then prints
  the events and `next: <iso>`. Pass that as `--since` to the next `wait` so nothing is missed
  or repeated.

### The agent loop

```sh
since=$(date -u +%FT%TZ)
while true; do
  out=$(blackboard wait my-board --since "$since" --json --timeout 30m) || [ $? -eq 3 ] || break
  since=$(jq -r .next <<<"$out")
  # read the events / `blackboard comments my-board`, edit the docs,
  # then `blackboard reply my-board <id> "done: …"` and maybe `blackboard resolve …`
done
```

In pi, run `blackboard wait` with `bash_bg`: its completion message is the notification.

## Comment file

One file per board: `<board>/.blackboard/comments.json`. Writes go to a temp file that is
renamed over the old one, so the file is never half-written. A file that does not parse is
reported, never overwritten.

```json
{
  "version": 1,
  "docs": {
    "design.md": [
      {
        "id": "c_913dee56b1b1",
        "quote": {
          "exact": "The cache is warm.",
          "prefix": "is warm. Later text. ",
          "suffix": " End of overview."
        },
        "body": "Why is it warm at boot?",
        "author": "jun",
        "createdAt": "2026-10-16T19:58:37.093Z",
        "status": "resolved",
        "resolvedAt": "2026-10-16T20:10:00.000Z",
        "resolvedBy": "jun",
        "replies": [
          {
            "id": "r_1a2b3c4d5e6f",
            "body": "Preloaded by the worker.",
            "author": "agent",
            "createdAt": "2026-10-16T20:05:00.000Z"
          }
        ]
      }
    ]
  }
}
```

- `docs` is keyed by the board-relative doc path (`research/notes.md`).
- `quote.exact` is the selected text; `prefix` / `suffix` are up to 32 characters around it,
  used to pick the right copy when the passage repeats. Offsets are over the doc's rendered
  plain text, with diagram blocks left out.
- `status` is `open` or `resolved`; `resolvedAt` / `resolvedBy` exist only while resolved;
  `reopenedAt` / `reopenedBy` record the last reopen.
- `editedAt` appears on a comment or reply once its body has been edited. Deleting removes the
  entry from the file (no tombstone); a doc with no comments left drops its key.
- Prefer the `blackboard` CLI to editing the file by hand: it takes the shared lock
  (`comments.json.lock`), so it never races the web app.

## Board template

[`templates/board`](templates/board) has `brief.md`, `design.md`, `decisions.md` and
`questions.md`. `{{title}}` and `{{date}}` are filled in. Each section is a question heading
with a one-line **bold answer** first. Every file starts with an HTML comment holding the
writing rules (adapted from Whiteboard's authoring guide): what/why → requirements → design
→ implementation; at most three sentences of prose before a diagram or table; read the whole
board back and fix contradictions. The rules are invisible in the browser and visible to an
agent reading the file.

## Layout

```text
app/                      pages, /api/comments, /api/watch (SSE), server action for new boards
components/               DocView (selection + highlights), CommentPanel, FileTree, Toc, Mermaid
lib/anchor.ts             find a quoted passage again (pure, tested)
lib/comments-store.ts     comment file read / locked atomic write (lib/lock.ts)
lib/activity.ts           what others did since a time (for `wait`)
lib/cli.ts, bin/          the `blackboard` command
lib/paths.ts, boards.ts   root confinement, board and doc listing
lib/markdown.ts           unified pipeline: GFM, heading ids, legacy marks, mermaid placeholders
proxy.ts                  localhost-only Host and Origin checks
templates/board/          new-board template
```

## License

[MIT](LICENSE) © Jun Guo

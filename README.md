# Blackboard

A local web app for reviewing markdown documents (with mermaid diagrams) and leaving comments
on the text, so a person and a coding agent can go back and forth on a plan.

A **session** is one markdown file, anywhere on disk. You open it with `blackboard open <file>`;
the browser shows the doc with where it lives (repo and path) and which git branch it is on.
You select text and comment; an agent reads the file from disk and takes part through the
same `blackboard` CLI (see [CLI for agents](#cli-for-agents)).

Requires [bun](https://bun.sh) 1.3+. macOS and Linux; browsers: Chrome/Edge and Safari 17.2+
(CSS Custom Highlight API).

## Run it

```sh
bun install
bun dev                              # http://127.0.0.1:38770
bun link                             # once: puts `blackboard` on PATH (~/.bun/bin)
blackboard open docs/design.md       # registers the file and opens its tab
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `BLACKBOARD_HOME` | `~/.blackboard` | Blackboard's own folder: the session list, each session's comments, the scratchpad. |
| `PORT` | `38770` | Port for `bun dev` / `bun start`. |
| `BLACKBOARD_URL` | `http://127.0.0.1:38770` | Where `blackboard open` points the browser. |

The server binds `127.0.0.1` and answers only `localhost` / `127.0.0.1` / `[::1]` Host
headers; writes from another site's Origin get a 403. It serves only files that were
registered with `blackboard open`, and re-checks on every request that the path is still a
markdown file (a file swapped for a symlink to somewhere else is refused).

Checks: `bun run typecheck`, `bun run lint`, `bun test`, `bun run build`.

## What it does

- **Home** — the scratchpad card on top, then a table of sessions: title (front matter
  `title`, else the first `#` heading, else the file name) with its location (`repo/path` inside
  git, the full path outside), the current branch, open comments, created and updated. Search
  matches title, path, repo and branch; filter by repo (or "No repo"); sort by newest, created
  or title. The choices stay in the URL, so they survive a reload.
- **Tabs** — a strip across the top: back / forward, a pinned Home tab and one tab per opened
  doc. Opening a doc from Home, the CLI or a typed URL adds its tab; × or a middle click closes
  one, and closing the open doc moves to its neighbour. Tabs are kept in the browser's
  local storage, so they survive a reload.
- **Scratchpad** — one free-form doc at `$BLACKBOARD_HOME/scratchpad.md`, pinned on Home; its card
  counts sections and diagrams. You can comment on it like any doc.
- **Doc view** — GitHub-style markdown (tables with sticky headers, heading anchors), a table of
  contents, and a header with the location and a branch chip. YAML front matter shows as a
  field / value table: lists as chips, maps as nested tables, empty values as blank cells; YAML
  that does not parse is shown as source. Raw HTML in a doc is not rendered.
- **Diagrams** — fenced `mermaid` blocks render in the browser from the bundled library, so
  they work offline.
- **Comments** — select text, click **Comment**, type a note. Replies are flat; comments can be
  resolved and reopened. Your own comments and replies (same author name) show **Edit** and
  **Delete** on hover; delete asks first and removes the comment with its replies.
- **Click a highlight** — the pointer changes over highlighted text; a click focuses that
  comment in the panel. Clicking a comment in the panel scrolls the doc to its passage.
- **Live view** — the page refreshes when the file changes on disk. Highlights follow their
  passage; a comment whose passage is gone stays in the list as *orphaned*.
- **Copy open** — copies the doc's open comments as markdown (title, file, then quote, note,
  replies) to paste to an agent.
- **Old marks** — `==passage==[^n]` shows as a read-only yellow highlight with the footnote as
  a tooltip. They are not comments.
- **Missing files** — a session whose file was moved or deleted shows as `missing`; open the new
  path with `blackboard open`.

## CLI for agents

`blackboard` opens files and reads and answers comments from a shell, so any agent with a shell
(pi, Claude Code, Codex) can take part. It edits the files under `$BLACKBOARD_HOME` directly,
under a lock shared with the web app, so it works whether or not the app is running; an open
page shows its changes live.

```sh
blackboard open     <file> [--no-browser]         # prints "<id>  <url>"; again is fine
blackboard sessions [--json]                      # id, title, location, branch, open comments
blackboard close    <session>                     # forget it; its comments are kept
blackboard comments <session> [--all] [--json]    # open comments by default
blackboard reply    <session> <comment-id> "text"
blackboard resolve  <session> <comment-id>        # or: reopen
blackboard comment  <session> --quote "passage" [--occurrence 2] "note"
blackboard wait     <session> [--since <iso>] [--timeout 30m] [--json]
blackboard import   <root> [--dry-run]            # comments from the old folder-of-boards layout
```

`<session>` is a session id or a path to the registered file (relative paths are fine).

| Setting | Default | Meaning |
|---------|---------|---------|
| `--home` / `BLACKBOARD_HOME` | `~/.blackboard` | Blackboard's folder |
| `--author` / `BLACKBOARD_AUTHOR` | `agent` | Name on what the CLI writes; `wait` ignores this author's own activity |
| `--no-browser` / `BLACKBOARD_NO_BROWSER=1` | off | `open` registers without launching the browser |

Exit codes: `0` ok, `1` command failed (not a markdown file, unknown session / id, quote not
found), `2` bad usage, `3` `wait` timed out with nothing new.

- `open` gives the same id for the same file every time (it is derived from the file's real
  path), and launches the browser with `open` (macOS) or `xdg-open`.
- `comment` finds the passage in the doc's rendered text (the same text the browser anchors
  against), so the highlight lands where the agent meant. `--occurrence` picks a repeat.
- `wait` blocks until someone else comments, replies, edits, reopens or resolves, then prints
  the events and `next: <iso>`. Pass that as `--since` to the next `wait` so nothing is missed
  or repeated.

### The agent loop

```sh
blackboard open docs/design.md --no-browser
since=$(date -u +%FT%TZ)
while true; do
  out=$(blackboard wait docs/design.md --since "$since" --json --timeout 30m) || [ $? -eq 3 ] || break
  since=$(jq -r .next <<<"$out")
  # read the events / `blackboard comments docs/design.md`, edit the doc,
  # then `blackboard reply docs/design.md <id> "done: …"` and maybe `blackboard resolve …`
done
```

In pi, run `blackboard wait` with `bash_bg`: its completion message is the notification.

### Moving from boards

Earlier versions showed a folder of boards (`BLACKBOARD_ROOT`, one sub-folder per board, comments
in `<board>/.blackboard/comments.json`). `blackboard import <root>` registers every doc that has
comments there and copies them into its session. It skips sessions that already have comments,
so it is safe to run twice, and it never changes the old files. Try `--dry-run` first.

## Files

```text
$BLACKBOARD_HOME/
  sessions.json                 the registered files
  sessions/<id>/comments.json   one session's comments
  scratchpad.md                 the scratchpad
```

`sessions.json`:

```json
{
  "version": 1,
  "sessions": [
    { "id": "3dc91666ea", "path": "/work/app/docs/design.md", "createdAt": "2026-10-16T19:40:00.000Z", "openedAt": "2026-10-16T19:40:00.000Z" }
  ]
}
```

A comment file (writes go to a temp file renamed over the old one, so it is never
half-written; a file that does not parse is reported, never overwritten):

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

- `docs` has one key, the doc's file name.
- `quote.exact` is the selected text; `prefix` / `suffix` are up to 32 characters around it,
  used to pick the right copy when the passage repeats. Offsets are over the doc's rendered
  plain text, with diagram blocks left out.
- `status` is `open` or `resolved`; `resolvedAt` / `resolvedBy` exist only while resolved;
  `reopenedAt` / `reopenedBy` record the last reopen.
- `editedAt` appears on a comment or reply once its body has been edited. Deleting removes the
  entry from the file (no tombstone).
- Prefer the `blackboard` CLI to editing these files by hand: it takes the shared lock
  (`<file>.lock`), so it never races the web app.

## Layout

```text
app/                      Home (/), a session (/s/<id>), /api/comments, /api/watch (SSE)
components/               TabStrip, SessionTable, DocView (selection + highlights), CommentPanel, Toc, Mermaid
lib/sessions.ts           the session registry, comment-file paths, rows for Home and the CLI
lib/doc-meta.ts           title, repo, branch and stats of a doc
lib/tabs.ts               the tab strip's model (pure, tested)
lib/anchor.ts             find a quoted passage again (pure, tested)
lib/comments-store.ts     comment file read / locked atomic write (lib/lock.ts)
lib/activity.ts           what others did since a time (for `wait`)
lib/import.ts             comments from the old folder-of-boards layout
lib/cli.ts, bin/          the `blackboard` command
lib/markdown.ts           unified pipeline: GFM, heading ids, legacy marks, mermaid placeholders
proxy.ts                  localhost-only Host and Origin checks
```

## License

[MIT](LICENSE) © Jun Guo

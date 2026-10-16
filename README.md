# Blackboard

A local web app for reading a project's planning docs (markdown with mermaid diagrams) and
leaving comments on the text, so Jun and an agent can go back and forth on a plan.

There is no agent connection: the agent reads the docs and the comment file from disk, and
Jun reads and comments in the browser.

## Run it

```sh
bun install
BLACKBOARD_ROOT=~/.notebook/kanban/mistplay/mistplay-files bun dev
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
- `status` is `open` or `resolved`; `resolvedAt` / `resolvedBy` exist only while resolved.
- `editedAt` appears on a comment or reply once its body has been edited. Deleting removes the
  entry from the file (no tombstone); a doc with no comments left drops its key.
- An agent may add a reply by editing the file (keep the shape; any unique `id`). The page
  picks the change up live.

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
lib/comments-store.ts     comment file read / queued atomic write
lib/paths.ts, boards.ts   root confinement, board and doc listing
lib/markdown.ts           unified pipeline: GFM, heading ids, legacy marks, mermaid placeholders
proxy.ts                  localhost-only Host and Origin checks
templates/board/          new-board template
```

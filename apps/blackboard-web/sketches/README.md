# Sketches

Static, throwaway-quality but pixel-faithful mockups for decisions that are cheaper to make by
looking than by describing. Plain HTML/CSS/JS — no framework, no build, nothing imported from
`app/`; a sketch never ships.

    bun sketches/serve.ts 38800     # then open http://127.0.0.1:38800/<name>/

| Sketch | Question it answers |
|---|---|
| `reading-config` | Which palette (paper / plain / night) and which Latin / 中文 / 等宽 pairing should Blackboard default to? |
| `diff-sidebar` | where the local-PR diff panel lives (4th column vs drawer), what `file:path:L<a>-<b>` links look like, and whether green/red line diff survives all palettes |
| `code-comments` | can comments live INSIDE a Local PR snippet — line-anchored inline threads, the `+` entry, and what the Comments tab shows for a code anchor |
| `stream-block-style` | what a stream block looks like without the coloured side rule and the action pill — quiet meta line (A), numbered sections (B), or headless (C) |
| `reading-workspace` | what the inbox becomes once reading is the job: one column of docs (v1), marked tabs beside it (v2), or a timeline of exchanges (v3) |
| `reading-workspace-mobile` | how that workspace folds onto a phone — list, preview and settings as three tabs, with the reading tools in a bottom pill |

`diff-sidebar` and `code-comments` are historical: both mock the Local PR pane and `file:` links,
which the product no longer ships. They are kept as a record of the decisions, not as a
description of today's app.

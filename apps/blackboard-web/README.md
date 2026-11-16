# @gjuoun/blackboard

Read markdown plans in the browser and comment on the text, so you and a coding agent can go back
and forth on them.

```sh
bun add -g @gjuoun/blackboard   # or: npm i -g @gjuoun/blackboard
blackboard serve start          # one process on 38770 — UI + API on the same port
```

Sessions live in `~/.blackboard`; your documents stay wherever they are on disk. The `blackboard`
CLI is what an agent drives — `blackboard sessions`, `comments`, `reply`, `blocks`, `patch`.

For local dev (`bun run dev:start`) the Vite server can't load `bun:sqlite` — the API runs as a
second process: `bun api/server.ts &` with `BLACKBOARD_API_URL=http://127.0.0.1:38771`.

This package is the app and the CLI; the theme it renders with is `@gjuoun/bb-ui`, which ships
inside `server/` rather than as a separate install.

Full documentation, the engineering contract and the source live at
[github.com/gjuoun/blackboard](https://github.com/gjuoun/blackboard).
# Security policy

Blackboard runs on your own machine, on `127.0.0.1`, and keeps your documents, sessions and comments
in `~/.blackboard`. It has no account system and no server of its own. That does not make it
risk-free: it reads files you point it at, serves them over HTTP, and renders markdown that comes
from disk or from an agent.

## Supported versions

Fixes land on `main` and ship in the next release. Only the latest published version is supported —
there are no backports to older versions.

| Version | Supported |
|---|---|
| latest `@gjuoun/blackboard` | yes |
| anything older | no — upgrade first, then report if it still reproduces |

## Reporting a vulnerability

Report privately, not in a public issue: use GitHub's
[private vulnerability reporting](https://github.com/gjuoun/blackboard/security/advisories/new)
on this repository. That opens a draft advisory only you and the maintainer can see.

Please include:

- what an attacker gains — read a file outside the session, run code, exfiltrate comments
- the exact version (`blackboard --version`) and platform
- reproduction steps, starting from a clean `BLACKBOARD_HOME`
- whether the app was reachable beyond `127.0.0.1` at the time

You will get an acknowledgement within **7 days**. If a fix is warranted, it ships on `main` and you
are credited in the advisory unless you ask not to be.

## In scope

- reading or writing files outside the paths a session was opened for
- escaping the rendered markdown (script injection through a document, a comment or an exchanged block)
- the API accepting requests from an origin it should not (`/api/*`, the SSE stream)
- anything that turns a downloaded document or a pasted comment into code execution

## Out of scope

- **Anyone who can already read your disk, your shell history or `~/.blackboard`** — the app's store is
  a local SQLite file with your own filesystem permissions, not an encrypted vault.
- **Exposing the app to the internet** (`serve start --port` bound to a public interface, a tunnel, a
  reverse proxy). The app assumes a single trusted user on loopback. If you expose it, the exposure is
  the vulnerability.
- Denial of service from a document you deliberately wrote (a 50 MB markdown file is not a CVE).
- Bugs that need an attacker to already be running code on the same machine as you.

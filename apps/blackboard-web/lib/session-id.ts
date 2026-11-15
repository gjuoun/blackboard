/**
 * What a session id looks like, as the three generators write it — and nothing wider:
 *  - a file session is the first 10 hex characters of the sha1 of its real path
 *    (`sessionId`, lib/sessions.ts);
 *  - a streamed document is `s-` plus a 26-character Crockford-base32 ULID
 *    (`streamId`, lib/stream-store.ts);
 *  - the scratchpad is the literal `scratchpad` (`SCRATCHPAD_ID`, lib/session-model.ts).
 * The browser imports this module, so it keeps no node or Effect imports.
 */
const FILE_ID = /^[0-9a-f]{10}$/;
const STREAM_ID = /^s-[0-9A-HJKMNP-TV-Z]{26}$/;
const SCRATCHPAD = "scratchpad";

/** Whether a string is an id one of the session generators can produce. */
export function isSessionId(id: string): boolean {
  return FILE_ID.test(id) || STREAM_ID.test(id) || id === SCRATCHPAD;
}

/** The session id in the URL `/s/<id>` (a trailing slash is tolerated), or null on every other path. */
export const sessionIdOf = (pathname: string) => {
  const id = /^\/s\/([^/]+)\/?$/.exec(pathname)?.[1];
  return id && isSessionId(id) ? id : null;
};

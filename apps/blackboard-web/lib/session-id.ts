/**
 * What a session id looks like: the first 10 hex characters of the sha1 of a doc's real path
 * (`sessionId`, lib/sessions.ts). The browser imports this module, so it keeps no node or Effect
 * imports.
 */
const FILE_ID = /^[0-9a-f]{10}$/;

/** Whether a string is an id the session generator can produce. */
export function isSessionId(id: string): boolean {
  return FILE_ID.test(id);
}

/** The session id in the URL `/s/<id>` (a trailing slash is tolerated), or null on every other path. */
export const sessionIdOf = (pathname: string) => {
  const id = /^\/s\/([^/]+)\/?$/.exec(pathname)?.[1];
  return id && isSessionId(id) ? id : null;
};

import { readFileSync } from "node:fs";
import { Pipe, Safe } from "@gjuoun/safe-ts";
import { type ApiFailure, apiGet, apiPatch, apiPost } from "../api-client";
import { apiUrl } from "../api-origin";
import { type CliError, cliFailure, type DocComment, docOf, find, threadOf } from "../cli";
import type { CommentFile, CommentsStore } from "../comments-store";
import { renderPlainText } from "../markdown";
import { selectorFor } from "../selector";
import type { Session, SessionsStore } from "../sessions";

/**
 * The comment commands. Each writes through the API this home records; with no API recorded, a Bun
 * CLI runs the same store call in-process (the offline path). A Node CLI reports the missing API. The
 * API answers rendered `html` next to every comment, which the CLI strips so its output matches the
 * stored shape.
 */

type Stored = Omit<DocComment, "replies"> & {
  html?: string;
  replies: (DocComment["replies"][number] & { html?: string })[];
};

const plain = (c: Stored): DocComment => {
  const { html: _h, ...rest } = c;
  return {
    ...rest,
    replies: rest.replies.map((r) => {
      const { html: _r, ...kept } = r;
      return kept;
    }),
  } as DocComment;
};

/** Offline is allowed only under Bun, and only when this home records no API. */
const offlineOk = (home: string): boolean => process.versions.bun !== undefined && apiUrl(home) === null;

const cliError = (message: string, code: 1 | 2 = 1): CliError => ({ CliError: { message, code } });

/** Try the API; when it is unreachable and the offline path applies, run the store call instead. */
function route<A>(home: string, api: Safe<A, ApiFailure>, local: () => Safe<A, CliError>): Safe<A, CliError> {
  return Safe.try(function* () {
    return (yield Safe.pipe(
      api,
      Pipe.catchTag("ApiUnreachable", (e: { message: string }) =>
        offlineOk(home) ? local() : Safe.err(cliError(e.message)),
      ),
      Pipe.catchTag("ApiRefused", (e: { message: string }) => Safe.err(cliError(e.message))),
    )) as A;
  }) as unknown as Safe<A, CliError>;
}

/** The doc's comments as the API answered them, with the doc key the CLI resolved stamped on. */
const fromApi = (home: string, sessionId: string, doc: string) =>
  Safe.try(function* () {
    const data = (yield apiGet(home, `/api/comments?session=${encodeURIComponent(sessionId)}`)) as {
      comments?: Stored[];
    };
    return (data.comments ?? []).map((c) => ({ ...plain(c), doc }));
  }) as unknown as Safe<DocComment[], ApiFailure>;

const groupByDoc = (list: DocComment[]): Record<string, DocComment[]> => {
  const docs: Record<string, DocComment[]> = {};
  for (const c of list) (docs[c.doc] ??= []).push(c);
  return docs;
};

const asFile = (list: DocComment[]): CommentFile => ({ version: 1, docs: groupByDoc(list) });

/** Every comment in a session, resolved ones included, each with its replies, in creation order. */
export function comments(
  sessions: SessionsStore,
  store: CommentsStore,
  home: string,
  ref: string,
  cwd = process.cwd(),
): Safe<DocComment[], CliError> {
  return Safe.try(function* () {
    const { session, doc } = (yield find(sessions, home, ref, cwd)) as { session: Session; doc: string };
    const local = () =>
      Safe.try(function* () {
        const list = (yield store.list(home, session.id)) as DocComment[];
        return list;
      }) as unknown as Safe<DocComment[], CliError>;
    return (yield route(home, fromApi(home, session.id, doc), local)) as DocComment[];
  }) as unknown as Safe<DocComment[], CliError>;
}

/** An independent comment: no passage. */
export function commentGeneral(
  sessions: SessionsStore,
  store: CommentsStore,
  home: string,
  ref: string,
  note: string,
  author: string,
  cwd = process.cwd(),
): Safe<DocComment, CliError> {
  return Safe.try(function* () {
    if (!note.trim()) return (yield Safe.err(cliError("comment text is empty", 2))) as never;
    const { session, doc } = (yield find(sessions, home, ref, cwd)) as { session: Session; doc: string };
    const body = note.trim();
    const api = Safe.try(function* () {
      const data = (yield apiPost(home, "/api/comments", {
        session: session.id,
        general: true,
        body,
        author,
      })) as { comment: Stored };
      return { ...plain(data.comment), doc };
    }) as unknown as Safe<DocComment, ApiFailure>;
    const local = () =>
      Safe.try(function* () {
        const c = (yield store.add(home, session.id, doc, { general: true, body, author })) as DocComment;
        return { ...c, doc };
      }) as unknown as Safe<DocComment, CliError>;
    return (yield route(home, api, local)) as DocComment;
  }) as unknown as Safe<DocComment, CliError>;
}

/** Reply to a comment, or to one of its replies: the id names either, the text joins that thread. */
export function reply(
  sessions: SessionsStore,
  store: CommentsStore,
  home: string,
  ref: string,
  id: string,
  body: string,
  author: string,
  cwd = process.cwd(),
): Safe<DocComment, CliError> {
  return Safe.try(function* () {
    if (!body.trim()) return (yield Safe.err(cliError("reply text is empty", 2))) as never;
    const { session, doc: sessionDoc } = (yield find(sessions, home, ref, cwd)) as {
      session: Session;
      doc: string;
    };
    const text = body.trim();
    const list = (yield route(
      home,
      fromApi(home, session.id, sessionDoc),
      () =>
        Safe.try(function* () {
          return (yield store.list(home, session.id)) as DocComment[];
        }) as unknown as Safe<DocComment[], CliError>,
    )) as DocComment[];
    const { doc, commentId } = (yield threadOf(asFile(list), id)) as { doc: string; commentId: string };
    const api = Safe.try(function* () {
      const data = (yield apiPatch(home, "/api/comments", {
        session: session.id,
        id: commentId,
        action: "reply",
        body: text,
        author,
      })) as { comment: Stored };
      return { ...plain(data.comment), doc };
    }) as unknown as Safe<DocComment, ApiFailure>;
    const local = () =>
      Safe.try(function* () {
        const c = (yield store.reply(home, commentId, doc, { body: text, author })) as DocComment;
        return { ...c, doc };
      }) as unknown as Safe<DocComment, CliError>;
    return (yield route(home, api, local)) as DocComment;
  }) as unknown as Safe<DocComment, CliError>;
}

/** Resolve or reopen one comment, by id. */
export function status(
  sessions: SessionsStore,
  store: CommentsStore,
  home: string,
  ref: string,
  id: string,
  to: "resolved" | "open",
  author: string,
  cwd = process.cwd(),
): Safe<DocComment, CliError> {
  return Safe.try(function* () {
    const { session, doc: sessionDoc } = (yield find(sessions, home, ref, cwd)) as {
      session: Session;
      doc: string;
    };
    const list = (yield route(
      home,
      fromApi(home, session.id, sessionDoc),
      () =>
        Safe.try(function* () {
          return (yield store.list(home, session.id)) as DocComment[];
        }) as unknown as Safe<DocComment[], CliError>,
    )) as DocComment[];
    const doc = (yield docOf(asFile(list), id)) as string;
    const action = to === "resolved" ? "resolve" : "reopen";
    const api = Safe.try(function* () {
      const data = (yield apiPatch(home, "/api/comments", {
        session: session.id,
        id,
        action,
        author,
      })) as { comment: Stored };
      return { ...plain(data.comment), doc };
    }) as unknown as Safe<DocComment, ApiFailure>;
    const local = () =>
      Safe.try(function* () {
        const c = (yield store.setStatus(home, id, doc, to, author)) as DocComment;
        return { ...c, doc };
      }) as unknown as Safe<DocComment, CliError>;
    return (yield route(home, api, local)) as DocComment;
  }) as unknown as Safe<DocComment, CliError>;
}

/** Comment on the n-th occurrence of quote in the session doc, as the agent. */
export function comment(
  sessions: SessionsStore,
  store: CommentsStore,
  home: string,
  ref: string,
  quote: string,
  note: string,
  author: string,
  occurrence = 1,
  cwd = process.cwd(),
): Safe<DocComment, CliError> {
  return Safe.try(function* () {
    if (!note.trim()) return (yield Safe.err(cliError("comment text is empty", 2))) as never;
    const { session, doc } = (yield find(sessions, home, ref, cwd)) as { session: Session; doc: string };
    const src = (yield Safe.call(
      () => readFileSync(session.path, "utf8"),
      () => cliError(`the doc is missing: ${session.path}`),
    )) as string;
    const text = (yield Safe.call(
      async () => await renderPlainText(src),
      (error) => cliFailure({ message: String(error) }),
    )) as string;
    const sel = selectorFor(text, quote, occurrence);
    if (!sel.ok) return (yield Safe.err(cliError(sel.error))) as never;
    const body = note.trim();
    const api = Safe.try(function* () {
      const data = (yield apiPost(home, "/api/comments", {
        session: session.id,
        quote: sel.selector,
        body,
        author,
      })) as { comment: Stored };
      return { ...plain(data.comment), doc };
    }) as unknown as Safe<DocComment, ApiFailure>;
    const local = () =>
      Safe.try(function* () {
        const c = (yield store.add(home, session.id, doc, {
          quote: sel.selector,
          body,
          author,
        })) as DocComment;
        return { ...c, doc };
      }) as unknown as Safe<DocComment, CliError>;
    return (yield route(home, api, local)) as DocComment;
  }) as unknown as Safe<DocComment, CliError>;
}

import type { Binding } from "./agents-store";
import type { Comment } from "./comments-store";

/**
 * What a bound pi session receives when a comment is submitted. Small on purpose: the session reads
 * the full thread from the comment file with the CLI, not from this payload.
 */
export type AgentPayload = {
  kind: "comment";
  session: string;
  doc: string;
  /** The comment the payload is about. */
  commentId: string;
  /** Exactly one anchor kind, the same shape a comment stores. */
  anchor: { quote: Comment["quote"] } | { general: true };
  /** The comment body, as submitted. */
  body: string;
  author: string;
  at: string;
  /** Where a reader sees it: <app url>/s/<session>. */
  pageUrl: string;
};

/** The budget of one notify. Short because the comment is already stored and nobody waits for this. */
const TIMEOUT_MS = 500;

/** The payload for a submitted comment. */
export function payloadFor(input: {
  session: string;
  doc: string;
  comment: Comment;
  body: string;
  author: string;
  pageUrl: string;
  at?: string;
}): AgentPayload {
  return {
    kind: "comment",
    session: input.session,
    doc: input.doc,
    commentId: input.comment.id,
    anchor: input.comment.quote ? { quote: input.comment.quote } : { general: true },
    body: input.body,
    author: input.author,
    at: input.at ?? new Date().toISOString(),
    pageUrl: input.pageUrl,
  };
}

/**
 * POST one payload, never rejecting: an unreachable listener, a refused connection or a stalled one
 * is `false`, not an error. The timeout abandons the request after TIMEOUT_MS.
 */
export async function postPayload(url: string, payload: AgentPayload): Promise<boolean> {
  const answer = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  return answer?.ok === true;
}

/**
 * Hand the payload to the bound listener and return at once. The comment is already written when
 * this runs, so a session that is gone, busy or slow changes nothing the submitter sees: no
 * binding is a no-op, and no failure is reported anywhere. Coalescing is the extension's job.
 */
export function notifyAgent(binding: Binding | null, payload: AgentPayload): void {
  if (!binding) return;
  void postPayload(binding.url, payload);
}

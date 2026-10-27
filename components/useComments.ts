"use client";

import { useCallback, useState } from "react";
import type { QuoteSelector } from "@/lib/anchor";
import type { RenderedComment } from "@/lib/comment-markdown";

type Answer = { comment?: RenderedComment; deleted?: string };

async function call(method: string, payload: unknown): Promise<Answer> {
  const res = await fetch("/api/comments", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Comments for one doc, kept in sync with the server after each change. */
export function useComments(session: string, initial: RenderedComment[], author: string) {
  const [comments, setComments] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((a: Answer) => {
    const c = a.comment;
    if (c) setComments((list) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]));
    if (a.deleted) setComments((list) => list.filter((x) => x.id !== a.deleted));
  }, []);

  const run = useCallback(
    async (p: Promise<Answer>) => {
      try {
        apply(await p);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [apply],
  );

  const reload = useCallback(async () => {
    const res = await fetch(`/api/comments?session=${encodeURIComponent(session)}`);
    if (res.ok) setComments((await res.json()).comments);
  }, [session]);

  const patch = (id: string, action: string, extra: Record<string, string> = {}) =>
    run(call("PATCH", { session, id, action, author, ...extra }));

  return {
    comments,
    error,
    reload,
    add: (quote: QuoteSelector, body: string) => run(call("POST", { session, quote, body, author })),
    reply: (id: string, body: string) => patch(id, "reply", { body }),
    setResolved: (id: string, resolved: boolean) => patch(id, resolved ? "resolve" : "reopen"),
    edit: (id: string, body: string) => patch(id, "edit", { body }),
    remove: (id: string) => patch(id, "delete"),
    editReply: (id: string, replyId: string, body: string) => patch(id, "edit-reply", { replyId, body }),
    removeReply: (id: string, replyId: string) => patch(id, "delete-reply", { replyId }),
  };
}

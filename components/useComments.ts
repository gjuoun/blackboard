"use client";

import { useCallback, useState } from "react";
import type { QuoteSelector } from "@/lib/anchor";
import type { Comment } from "@/lib/comments-store";

async function call(method: string, payload: unknown): Promise<Comment> {
  const res = await fetch("/api/comments", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (await res.json()).comment;
}

/** Comments for one doc, kept in sync with the server after each change. */
export function useComments(board: string, doc: string, initial: Comment[], author: string) {
  const [comments, setComments] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const upsert = useCallback((c: Comment) => {
    setComments((list) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]));
  }, []);

  const run = useCallback(
    async (p: Promise<Comment>) => {
      try {
        upsert(await p);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [upsert],
  );

  const reload = useCallback(async () => {
    const res = await fetch(`/api/comments?board=${encodeURIComponent(board)}&doc=${encodeURIComponent(doc)}`);
    if (res.ok) setComments((await res.json()).comments);
  }, [board, doc]);

  return {
    comments,
    error,
    reload,
    add: (quote: QuoteSelector, body: string) => run(call("POST", { board, doc, quote, body, author })),
    reply: (id: string, body: string) => run(call("PATCH", { board, doc, id, action: "reply", body, author })),
    setResolved: (id: string, resolved: boolean) => run(call("PATCH", { board, doc, id, action: resolved ? "resolve" : "reopen", author })),
  };
}

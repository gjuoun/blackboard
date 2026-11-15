"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refresh the page when the session's doc changes on disk (re-render the server page: doc, TOC,
 * header) and reload the comments when its comment file changes.
 */
export function useLiveDoc(session: string, onCommentsChanged: () => void) {
  const router = useRouter();
  useEffect(() => {
    const es = new EventSource(`/api/watch?session=${encodeURIComponent(session)}`);
    es.addEventListener("changed", (e) => {
      const { doc, comments } = JSON.parse((e as MessageEvent).data) as { doc: boolean; comments: boolean };
      if (comments) onCommentsChanged();
      if (doc) router.refresh();
    });
    return () => es.close();
  }, [session, router, onCommentsChanged]);
}

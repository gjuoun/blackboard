"use client";

import { useNav } from "./nav";
import { useEffect } from "react";

/**
 * Refresh the page when the session's doc changes on disk (re-render the server page: doc, TOC,
 * header) and reload the comments when its comment file changes.
 */
export function useLiveDoc(session: string, onCommentsChanged: () => void) {
  const { refresh } = useNav();
  useEffect(() => {
    const es = new EventSource(`/api/watch?session=${encodeURIComponent(session)}`);
    es.addEventListener("changed", (e) => {
      const { doc, comments } = JSON.parse((e as MessageEvent).data) as { doc: boolean; comments: boolean };
      if (comments) onCommentsChanged();
      if (doc) refresh();
    });
    return () => es.close();
  }, [session, refresh, onCommentsChanged]);
}

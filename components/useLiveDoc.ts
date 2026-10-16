"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refresh the page when a file in the board changes on disk: a doc change re-renders the
 * server page (doc, TOC, file tree); a comment-file change reloads the comments.
 */
export function useLiveDoc(board: string, onCommentsChanged: () => void) {
  const router = useRouter();
  useEffect(() => {
    const es = new EventSource(`/api/watch?board=${encodeURIComponent(board)}`);
    es.addEventListener("changed", (e) => {
      const { paths } = JSON.parse((e as MessageEvent).data) as { paths: string[] };
      if (paths.some((p) => p.startsWith(".blackboard"))) onCommentsChanged();
      if (paths.some((p) => !p.startsWith(".blackboard"))) router.refresh();
    });
    return () => es.close();
  }, [board, router, onCommentsChanged]);
}

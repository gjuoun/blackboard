"use client";

import { useEffect, useRef, useState } from "react";
import { useVirtualDocContext } from "./useVirtualDoc";

// Follow the live edge: stay pinned until the reader is more than 80px above the bottom; re-engage
// only once they are back within 40px (the gap keeps a lazy thumb-scroll from flickering it on).
const FOLLOW_ENTER = 40;
const FOLLOW_EXIT = 80;

/** The follow latch as a pure transition — the scroll handler folds it over every scroll event. */
export function followState(following: boolean, distToBottom: number): boolean {
  if (distToBottom < FOLLOW_ENTER) return true;
  if (distToBottom > FOLLOW_EXIT) return false;
  return following;
}

/**
 * The live edge of a streamed doc: a mounted-once leaf that scrolls the tail exchange into view
 * whenever the document gains content — while the reader is at the bottom. Scrolling more than
 * 80px above the end releases the follow; getting back within 40px re-engages it. Renders
 * nothing: the sections it scrolls to are StreamBody's, server-rendered beside it.
 */
export function StreamFollow({ tailId, tailWriting }: { tailId: string | null; tailWriting: boolean }) {
  const virt = useVirtualDocContext();
  // The reader follows by default; scrolling more than the exit band above the end releases it.
  const [following, setFollowing] = useState(true);
  const initialTail = useRef(tailId);

  useEffect(() => {
    const onScroll = () => setFollowing((f) => followState(f, document.documentElement.scrollHeight - scrollY - innerHeight));
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  // New exchanges arrive via router.refresh(): the remount collapses the page's height for a
  // moment, so a scroll that fires then clamps near the top. The settle loop re-lands the tail
  // until the scroll stays — through the virtualizer once it owns the window again, by a plain
  // scroll when it does not. A finished stream opens at the top: the unchanged initial tail
  // only scrolls when it is still live.
  useEffect(() => {
    if (!following || !tailId) return;
    if (tailId === initialTail.current && !tailWriting) return;
    let raf = 0;
    let tick = 0;
    let lastY = -1;
    const land = () => {
      tick += 1;
      if (!virt.handle.scrollToId(tailId)) document.getElementById(tailId)?.scrollIntoView();
      const y = scrollY;
      // Stable = the landing held one frame: a still-collapsing document pulls it back and retries.
      if (lastY >= 0 && Math.abs(y - lastY) < 4) return;
      lastY = y;
      if (tick < 24) raf = requestAnimationFrame(land);
    };
    raf = requestAnimationFrame(land);
    return () => cancelAnimationFrame(raf);
  }, [following, tailId, tailWriting, virt, virt.version]);

  return null;
}

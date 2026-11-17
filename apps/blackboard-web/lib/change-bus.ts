/**
 * The mutation leg of /api/watch. With the database there is no file to watch for comments, so
 * every API mutation publishes a mark on a per-session channel instead; a file doc's saves still
 * come through its folder watch. Same wire, different source — the event stream is identical.
 *
 * A subscription made just after a mutation still receives that mark (the pending set is drained
 * on subscribe): the cost is at most one stale "changed" at connect, which only makes the page
 * re-read.
 */
export type ChangeListener = () => void;

export class ChangeBus {
  private readonly listeners = new Map<string, Set<ChangeListener>>();
  private readonly pending = new Set<string>();

  /** Announce that a session's comment surface changed. */
  publish(sessionId: string): void {
    this.pending.add(sessionId);
    for (const listener of this.listeners.get(sessionId) ?? []) listener();
  }

  /** Watch one session; the returned function unsubscribes. */
  subscribe(sessionId: string, listener: ChangeListener): () => void {
    const held = this.listeners.get(sessionId) ?? new Set<ChangeListener>();
    held.add(listener);
    this.listeners.set(sessionId, held);
    if (this.pending.delete(sessionId)) listener();
    return () => {
      held.delete(listener);
      if (held.size === 0) this.listeners.delete(sessionId);
    };
  }
}

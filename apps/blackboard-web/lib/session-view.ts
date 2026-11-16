import type { Comment } from "./comments-file";
import { apiGetJson } from "./api-client";
import type { RenderedComment } from "./comment-markdown";
import { docKey, type Session } from "./session-model";
import type { SessionRow } from "./sessions";

/** One session as the doc page reads it: its row, and its comments rendered for the page. */
export type LoadedSession = {
  session: Session;
  row: SessionRow;
  /** The markdown the index stored, or null when the file was missing when it was read. */
  body: string | null;
  comments: { docs: Record<string, RenderedComment[]> };
};

/** The session from the API; null when the id names no session. */
export async function loadSession(home: string, id: string): Promise<LoadedSession | null> {
  const data = await apiGetJson<{ session: Session; row: SessionRow; body: string | null; comments: RenderedComment[] }>(
    home,
    `/api/session?id=${encodeURIComponent(id)}`,
  ).catch(() => null);
  if (!data) return null;
  return {
    session: data.session,
    row: data.row,
    body: data.body,
    comments: { docs: groupDocs(data.session, data.comments) },
  };
}

/** The API answers one session's comments flat; the page reads them keyed by doc, so group them here. */
function groupDocs(session: Session, list: RenderedComment[]): Record<string, RenderedComment[]> {
  return { [docKey(session)]: list };
}

export type { Comment };

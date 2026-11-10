import type { Comment, Review } from "./comments-file";
import { apiGetJson } from "./api-fetch";
import type { RenderedComment } from "./comment-markdown";
import type { Session, SessionRow } from "./sessions";

/** One session as the doc page reads it: its row, and its comments and reviews rendered for the page. */
export type LoadedSession = {
  session: Session;
  row: SessionRow;
  comments: { docs: Record<string, RenderedComment[]>; reviews: Review[] };
};

/** The session from the API; null when the id names no session. */
export async function loadSession(home: string, id: string): Promise<LoadedSession | null> {
  const data = await apiGetJson<{ session: Session; row: SessionRow; comments: RenderedComment[]; reviews: Review[] }>(
    home,
    `/api/session?id=${encodeURIComponent(id)}`,
  ).catch(() => null);
  if (!data) return null;
  return {
    session: data.session,
    row: data.row,
    comments: { docs: groupDocs(data.session.path, data.comments), reviews: data.reviews },
  };
}

/** The API answers one session's comments flat; the page reads them keyed by doc, so group them here. */
function groupDocs(path: string, list: RenderedComment[]): Record<string, RenderedComment[]> {
  const key = path.slice(path.lastIndexOf("/") + 1);
  return { [key]: list };
}

export type { Comment };

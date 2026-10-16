import { basename } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import type { QuoteSelector } from "@/lib/anchor";
import { addComment, addReply, deleteComment, deleteReply, editComment, editReply, mutate, readComments, setStatus } from "@/lib/comments-store";
import { getHome } from "@/lib/home";
import { getSession, servablePath, sessionCommentsPath } from "@/lib/sessions";

const MAX_BODY = 10_000;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** The comment file and doc key for a request, but only for a registered session whose file can still be served. */
function target(session: unknown): { file: string; doc: string } | null {
  if (typeof session !== "string") return null;
  const home = getHome();
  const s = getSession(home, session);
  if (!s || !servablePath(s)) return null;
  return { file: sessionCommentsPath(home, s.id), doc: basename(s.path) };
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);
const author = (v: unknown) => text(v, 64)?.trim() ?? "jun";

function quote(v: unknown): QuoteSelector | null {
  if (!v || typeof v !== "object") return null;
  const q = v as Record<string, unknown>;
  if (!text(q.exact, MAX_BODY) || typeof q.prefix !== "string" || typeof q.suffix !== "string") return null;
  return { exact: q.exact as string, prefix: q.prefix.slice(-64), suffix: q.suffix.slice(0, 64) };
}

async function json(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** GET ?session= — the doc's comments, open and resolved. */
export async function GET(req: NextRequest) {
  const t = target(req.nextUrl.searchParams.get("session"));
  if (!t) return bad("unknown session");
  return NextResponse.json({ comments: readComments(t.file).docs[t.doc] ?? [] });
}

/** POST {session, quote, body, author} — a new comment on a passage. */
export async function POST(req: NextRequest) {
  const b = await json(req);
  const t = b && target(b.session);
  if (!b || !t) return bad("unknown session");
  const q = quote(b.quote);
  const body = text(b.body, MAX_BODY);
  if (!q || !body) return bad("quote and body are required");
  const comment = await mutate(t.file, (f) => addComment(f, t.doc, { quote: q, body, author: author(b.author) }));
  return NextResponse.json({ comment }, { status: 201 });
}

/**
 * PATCH {session, id, action, body?, replyId?, author?}
 * action: reply | resolve | reopen | edit | delete | edit-reply | delete-reply.
 * delete answers {deleted: id}; every other action answers the updated {comment}.
 */
export async function PATCH(req: NextRequest) {
  const b = await json(req);
  const t = b && target(b.session);
  if (!b || !t) return bad("unknown session");
  const id = text(b.id, 64);
  if (!id) return bad("id is required");
  const who = author(b.author);
  try {
    if (b.action === "reply") {
      const body = text(b.body, MAX_BODY);
      if (!body) return bad("body is required");
      return NextResponse.json({ comment: await mutate(t.file, (f) => addReply(f, t.doc, id, { body, author: who })) });
    }
    if (b.action === "edit") {
      const body = text(b.body, MAX_BODY);
      if (!body) return bad("body is required");
      return NextResponse.json({ comment: await mutate(t.file, (f) => editComment(f, t.doc, id, body)) });
    }
    if (b.action === "delete") {
      await mutate(t.file, (f) => deleteComment(f, t.doc, id));
      return NextResponse.json({ deleted: id });
    }
    if (b.action === "edit-reply" || b.action === "delete-reply") {
      const replyId = text(b.replyId, 64);
      if (!replyId) return bad("replyId is required");
      if (b.action === "delete-reply") {
        return NextResponse.json({ comment: await mutate(t.file, (f) => deleteReply(f, t.doc, id, replyId)) });
      }
      const body = text(b.body, MAX_BODY);
      if (!body) return bad("body is required");
      return NextResponse.json({ comment: await mutate(t.file, (f) => editReply(f, t.doc, id, replyId, body)) });
    }
    if (b.action === "resolve" || b.action === "reopen") {
      const status = b.action === "resolve" ? "resolved" : "open";
      return NextResponse.json({ comment: await mutate(t.file, (f) => setStatus(f, t.doc, id, status, who)) });
    }
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) return bad(err.message, 404);
    throw err;
  }
  return bad("unknown action");
}

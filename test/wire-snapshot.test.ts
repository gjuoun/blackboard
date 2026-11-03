import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { open } from "@/lib/cli/sessions";
import { GET as assetGet } from "@/app/api/asset/[id]/route";
import { DELETE as bindDelete, GET as bindGet, POST as bindPost } from "@/app/api/bind/route";
import { GET as commentsGet, PATCH as commentsPatch, POST as commentsPost } from "@/app/api/comments/route";
import { GET as imageGet } from "@/app/api/comment-images/[id]/route";
import { POST as imagePost } from "@/app/api/comment-images/route";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as watchGet } from "@/app/api/watch/route";
import { run } from "./app";

/**
 * The wire snapshot: every exported route handler, called directly, every branch it has today.
 * The file next to this test is generated from the code and then never edited by hand, so a
 * refactor that changes a status, a header or a body shape fails here instead of in a browser.
 */

const SNAPSHOT = join(import.meta.dir, "wire-snapshot.json");
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const decoder = new TextDecoder();
const out: Record<string, unknown> = {};
const literals: [string, string][] = [];

/** Everything volatile in a body — paths, ids, git shas, clock — becomes a placeholder. */
function normalize(text: string): string {
  let s = text;
  for (const [from, to] of literals) s = s.split(from).join(to);
  return s
    .replace(/[0-9a-f]{64}/g, "<sha256>")
    .replace(/[0-9a-f]{40}/g, "<sha>")
    .replace(/\b[cr]_[0-9a-f]{12}\b/g, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<time>");
}

function headersOf(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of [...res.headers].sort(([a], [b]) => a.localeCompare(b))) headers[k] = v;
  return headers;
}

function isBinary(contentType: string): boolean {
  return contentType !== "" && !/json|text|xml|html|javascript/.test(contentType);
}

/** One response as the wire sees it: status, content type, every header, body (base64 when binary). */
async function wire(res: Response): Promise<{ status: number; contentType: string; headers: Record<string, string>; body: string }> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  const body = isBinary(contentType) ? `base64:${Buffer.from(bytes).toString("base64")}` : decoder.decode(bytes);
  return { status: res.status, contentType, headers: headersOf(res), body: normalize(body) };
}

async function record(name: string, res: Response) {
  out[name] = await wire(res);
}

/** A temp Blackboard home with one doc, one real png, one empty png and one text file next to it. */
async function docsFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bb-wire-")));
  const home = join(base, "home");
  const docs = join(base, "docs");
  mkdirSync(docs, { recursive: true });
  const design = join(docs, "design.md");
  writeFileSync(design, "# Design\n\nLater text. More text.\n");
  writeFileSync(join(docs, "shot.png"), PNG);
  writeFileSync(join(docs, "empty.png"), new Uint8Array());
  writeFileSync(join(docs, "notes.txt"), "not an image\n");
  process.env.BLACKBOARD_HOME = home;
  process.env.BLACKBOARD_NO_BROWSER = "1";
  const { session } = await run(open(home, design));
  literals.push([base, "<base>"], [session.id, "<session>"]);
  return { base, home, docs, design, session: session.id };
}

const commentsUrl = "http://127.0.0.1/api/comments";
const body = (payload: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof payload === "string" ? payload : JSON.stringify(payload),
});
const get = (session: unknown) => commentsGet(new NextRequest(`${commentsUrl}?session=${String(session)}`));
const post = (payload: unknown) => commentsPost(new NextRequest(commentsUrl, body(payload)));
const patch = (payload: unknown) => commentsPatch(new NextRequest(commentsUrl, { ...body(payload), method: "PATCH" }));

describe("the wire the routes answer today", () => {
  test("every handler, every branch, matches the committed snapshot", async () => {
    const fx = await docsFixture();

    // health
    await record("health.GET", await healthGet());

    // comments GET
    await record("comments.GET.unknown-session", await get("nosuchid"));
    await record("comments.GET.empty", await get(fx.session));

    // comments POST — every refusal, then the success
    await record("comments.POST.bad-json", await post("{not json"));
    await record("comments.POST.unknown-session", await post({ session: "nosuchid", general: true, body: "x" }));
    await record("comments.POST.no-body", await post({ session: fx.session, general: true }));
    await record("comments.POST.no-anchor", await post({ session: fx.session, body: "x" }));
    await record("comments.POST.two-anchors", await post({ session: fx.session, body: "x", quote: { exact: "Later text.", prefix: "", suffix: "" }, general: true }));
    await record("comments.POST.bad-images", await post({ session: fx.session, general: true, body: "x", images: ["../etc/passwd"] }));
    await record("comments.POST.too-many-images", await post({ session: fx.session, general: true, body: "x", images: Array(5).fill("<sha256>.png") }));
    const created = await post({ session: fx.session, general: true, body: "**first** note", author: "jun" });
    const { comment } = (await created.clone().json()) as { comment: { id: string } };
    await record("comments.POST.ok", created);
    await record("comments.GET.one", await get(fx.session));
    await record("comments.POST.quoted.ok", await post({ session: fx.session, quote: { exact: "Later text.", prefix: "", suffix: "" }, body: "a passage note", author: "agent" }));
    await record("comments.GET.two", await get(fx.session));

    // comments PATCH — validation, then each action
    await record("comments.PATCH.unknown-session", await patch({ session: "nosuchid", id: comment.id, action: "resolve" }));
    await record("comments.PATCH.no-id", await patch({ session: fx.session, action: "resolve" }));
    await record("comments.PATCH.unknown-action", await patch({ session: fx.session, id: comment.id, action: "nope" }));
    await record("comments.PATCH.reply-no-body", await patch({ session: fx.session, id: comment.id, action: "reply" }));
    await record("comments.PATCH.reply-bad-reply-id", await patch({ session: fx.session, id: comment.id, action: "reply", body: "x", replyId: "" }));
    await record("comments.PATCH.comment-not-found", await patch({ session: fx.session, id: "c_000000000000", action: "resolve" }));
    const replied = await patch({ session: fx.session, id: comment.id, action: "reply", body: "answer with `x`", author: "agent" });
    const { comment: thread } = (await replied.clone().json()) as { comment: { replies: { id: string }[] } };
    await record("comments.PATCH.reply.ok", replied);
    const replyId = thread.replies[0].id;
    await record("comments.PATCH.reply-not-found", await patch({ session: fx.session, id: comment.id, action: "reply", body: "x", replyId: "r_000000000000" }));
    await record("comments.PATCH.edit-no-body", await patch({ session: fx.session, id: comment.id, action: "edit" }));
    await record("comments.PATCH.edit.ok", await patch({ session: fx.session, id: comment.id, action: "edit", body: "edited body" }));
    await record("comments.PATCH.edit-reply-no-reply-id", await patch({ session: fx.session, id: comment.id, action: "edit-reply", body: "x" }));
    await record("comments.PATCH.edit-reply-no-body", await patch({ session: fx.session, id: comment.id, action: "edit-reply", replyId, body: "" }));
    await record("comments.PATCH.edit-reply.ok", await patch({ session: fx.session, id: comment.id, action: "edit-reply", replyId, body: "edited reply" }));
    await record("comments.PATCH.resolve.ok", await patch({ session: fx.session, id: comment.id, action: "resolve" }));
    await record("comments.PATCH.reopen.ok", await patch({ session: fx.session, id: comment.id, action: "reopen" }));
    await record("comments.PATCH.delete-reply.ok", await patch({ session: fx.session, id: comment.id, action: "delete-reply", replyId }));
    await record("comments.PATCH.delete.ok", await patch({ session: fx.session, id: comment.id, action: "delete" }));

    // bind — validation, the record, and unbind; the notify never answers on the wire
    const bindUrl = "http://127.0.0.1/api/bind";
    const listenerUrl = "http://127.0.0.1:41234";
    const postBind = (payload: unknown) => bindPost(new NextRequest(bindUrl, body(payload)));
    const getBind = (session: string) => bindGet(new NextRequest(`${bindUrl}?session=${session}`));
    const deleteBind = (session: string) => bindDelete(new NextRequest(`${bindUrl}?session=${session}`, { method: "DELETE" }));
    await record("bind.POST.unknown-session", await postBind({ session: "nosuchid", piSession: "pi-1", url: listenerUrl }));
    await record("bind.POST.no-pi-session", await postBind({ session: fx.session, url: listenerUrl }));
    await record("bind.POST.bad-url", await postBind({ session: fx.session, piSession: "pi-1", url: "http://example.com:41234" }));
    await record("bind.GET.unknown-session", await getBind("nosuchid"));
    await record("bind.GET.none", await getBind(fx.session));
    await record("bind.POST.ok", await postBind({ session: fx.session, piSession: "pi-1", url: listenerUrl }));
    await record("bind.GET.bound", await getBind(fx.session));
    await record("bind.DELETE.ok", await deleteBind(fx.session));
    await record("bind.DELETE.none", await deleteBind(fx.session));
    // A submit with no binding: stored and answered as before, and the notify stays off the wire.
    await record("comments.POST.no-binding", await post({ session: fx.session, general: true, body: "unbound note" }));

    // asset
    const asset = (id: string, p?: string) => assetGet(new Request(`http://127.0.0.1/api/asset/${id}${p === undefined ? "" : `?p=${p}`}`), { params: Promise.resolve({ id }) });
    await record("asset.GET.no-session", await asset("nosuchid", "shot.png"));
    await record("asset.GET.missing-p", await asset(fx.session));
    await record("asset.GET.outside-doc-folder", await asset(fx.session, "../home/sessions.json"));
    await record("asset.GET.not-an-image", await asset(fx.session, "notes.txt"));
    await record("asset.GET.empty-file", await asset(fx.session, "empty.png"));
    await record("asset.GET.no-such-image", await asset(fx.session, "gone.png"));
    await record("asset.GET.ok", await asset(fx.session, "shot.png"));

    // comment images
    const upload = (bytes: Uint8Array) => imagePost(new NextRequest("http://127.0.0.1/api/comment-images", { method: "POST", body: bytes as unknown as BodyInit }));
    await record("comment-images.POST.rejected", await upload(new TextEncoder().encode("not an image")));
    const stored = await upload(PNG);
    const { id: imageId } = (await stored.clone().json()) as { id: string };
    await record("comment-images.POST.ok", stored);
    const image = (id: string) => imageGet(new NextRequest(`http://127.0.0.1/api/comment-images/${id}`), { params: Promise.resolve({ id }) });
    await record("comment-images.GET.bad-id", await image("not-an-id"));
    await record("comment-images.GET.not-stored", await image("0".repeat(64) + ".png"));
    await record("comment-images.GET.ok", await image(imageId));

    // watch: the unknown session, then the stream itself (first chunk, then cancel)
    await record("watch.GET.unknown-session", await watchGet(new NextRequest("http://127.0.0.1/api/watch?session=nosuchid")));
    const abort = new AbortController();
    const stream = await watchGet(new NextRequest(`http://127.0.0.1/api/watch?session=${fx.session}`, { signal: abort.signal }));
    const reader = stream.body!.getReader();
    const first = await reader.read();
    await reader.cancel();
    abort.abort();
    out["watch.GET.stream"] = {
      status: stream.status,
      contentType: stream.headers.get("content-type") ?? "",
      headers: headersOf(stream),
      body: normalize(decoder.decode(first.value)),
    };

    const actual = normalize(JSON.stringify(out, null, 2)) + "\n";
    if (!existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, actual);
    expect(actual).toBe(readFileSync(SNAPSHOT, "utf8"));
  });
});

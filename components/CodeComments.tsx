"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Composing =
  | { kind: "comment"; anchor: string; path: string; lineText: string; row: HTMLElement; host: HTMLElement }
  | { kind: "reply"; commentId: string; anchor: string; path: string; lineText: string; row: HTMLElement; host: HTMLElement };

/** The composer sits in the flow of the diff box, under the row or thread it answers. */
function hostAfter(row: HTMLElement): HTMLElement {
  const host = document.createElement("div");
  host.className = "cc-composer-host";
  row.after(host);
  return host;
}

const AUTHOR_KEY = "bb-author";
const reader = () => (localStorage.getItem(AUTHOR_KEY) ?? "jun").trim() || "jun";

const lineOf = (anchor: string) => Number(anchor.replace(/^L(old)?/, ""));

/** The anchor row or thread the click came from, and the line text it currently shows. */
function target(el: HTMLElement) {
  const row = el.closest<HTMLElement>(".dl");
  const box = el.closest<HTMLElement>("[data-path]");
  return { row, path: box?.dataset.path ?? "", lineText: row?.querySelector(".tx")?.textContent ?? "" };
}

/**
 * The one client piece of the code-comment layer: the line entry, the Reply… hint, the
 * Resolve conversation button and the inline composer. Everything a reader only reads — the
 * threads, their counts, the 💬 badge, the Comments-tab chip — is server HTML around this island,
 * so the diff still paints and reads with JavaScript off. After a write the server page refreshes
 * and prints the new thread from the comment file.
 */
export function CodeComments({ session, children }: { session?: string; children: ReactNode }) {
  const router = useRouter();
  const [composing, setComposing] = useState<Composing | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The host is created by the click, never during server render, so hydration stays
  // byte-identical. Closing or refreshing drops it again.
  useEffect(() => {
    if (!composing) return;
    const { host } = composing;
    return () => host.remove();
  }, [composing]);

  const close = () => {
    setComposing(null);
    setNote("");
    setError(null);
  };

  const write = async (method: "POST" | "PATCH", payload: Record<string, unknown>) => {
    const res = await fetch("/api/comments", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "HTTP " + res.status);
    close();
    router.refresh();
  };

  const send = async () => {
    if (!composing || !note.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = note.trim();
      const author = reader();
      const side = composing.anchor.startsWith("Lold") ? "old" : "new";
      if (composing.kind === "comment") {
        await write("POST", {
          session,
          code: { path: composing.path, startLine: lineOf(composing.anchor), endLine: lineOf(composing.anchor), side, lineText: composing.lineText },
          body,
          author,
        });
      } else {
        await write("PATCH", { session, id: composing.commentId, action: "reply", body, author });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (id: string, resolved: boolean) => {
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, id, action: resolved ? "reopen" : "resolve", author: reader() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "HTTP " + res.status);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el || !session) return;
    if (el.classList.contains("cc-add")) {
      const anchor = el.dataset.anchor ?? "";
      const { row, path, lineText } = target(el);
      if (anchor && row && path) setComposing({ kind: "comment", anchor, path, lineText, row, host: hostAfter(row) });
      return;
    }
    if (el.classList.contains("cc-reply")) {
      const thread = el.closest<HTMLElement>(".cc-thread");
      const commentId = el.dataset.id;
      const { path } = target(el);
      if (thread && path && commentId) {
        setComposing({ kind: "reply", commentId, anchor: thread.dataset.anchor ?? "", path, lineText: "", row: thread, host: hostAfter(thread) });
      }
      return;
    }
    if (el.classList.contains("cc-resolve") && el.dataset.id) void resolve(el.dataset.id, el.dataset.resolved === "true");
  };

  const composer = composing ? (
    <div className="cc-composer" data-testid="code-composer">
      <p className="cc-quote">
        {composing.anchor}
        {composing.lineText ? " \u00b7 " + composing.lineText : ""}
      </p>
      <textarea
        data-testid="code-composer-input"
        autoFocus
        rows={2}
        placeholder={composing.kind === "reply" ? "Reply\u2026" : "Comment\u2026"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          if (e.key === "Escape") close();
        }}
      />
      {error ? <p className="cc-error" role="alert">{error}</p> : null}
      <div className="cc-row">
        <button type="button" className="cc-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="cc-btn primary" data-testid="code-composer-save" disabled={!note.trim() || busy} onClick={() => void send()}>
          {composing.kind === "reply" ? "Reply" : "Comment"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div data-testid="code-comments" onClick={onClick}>
      {children}
      {composing && composer ? createPortal(composer, composing.host) : null}
    </div>
  );
}

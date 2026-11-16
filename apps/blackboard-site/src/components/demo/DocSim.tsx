import { useState } from "react";
import { Badge } from "@gjuoun/bb-ui/components/ui/badge";
import { Button } from "@gjuoun/bb-ui/components/ui/button";
import type { DemoComment, DemoDict } from "./data";

// bb-ui's Sheet portals to document.body, which would escape the phone clip — so the demo
// re-implements the bottom sheet as an absolute panel inside the stage. Same visual contract:
// rounded-t-2xl, drag handle, scrim, max-h.
function BottomPanel({
  maxH,
  title,
  onClose,
  children,
}: {
  maxH: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-40">
      <button type="button" aria-label="close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-border bg-background shadow-lg ${maxH}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
        <div className="px-4 pt-2 pb-1 text-sm font-semibold">{title}</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

export function DocSim({ dict, onBack }: { dict: DemoDict; onBack: () => void }) {
  const [panel, setPanel] = useState<"toc" | "cm" | null>(null);
  const [comments, setComments] = useState<DemoComment[]>(dict.doc.comments);
  const [draft, setDraft] = useState("");

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setComments((c) => [...c, { author: "you", time: "now", body }]);
    setDraft("");
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* doc body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-24">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        >
          ← {dict.backToInbox}
        </button>
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap">
          <Badge variant="secondary" className="font-mono text-[9.5px]">
            {dict.doc.path}
          </Badge>
          <Badge variant="outline" className="text-[9.5px]">
            {dict.doc.branch}
          </Badge>
        </div>
        <h1 className="mb-2 text-[19px] font-bold leading-snug">{dict.doc.title}</h1>
        {dict.doc.blocks.map((b, i) => {
          if (b.kind === "h2")
            return (
              <h2 key={i} className="mt-4 mb-1.5 text-[15px] font-semibold">
                {b.text}
              </h2>
            );
          if (b.kind === "code")
            return (
              <pre
                key={i}
                className="my-2 overflow-x-auto rounded-lg bg-code p-3 font-mono text-[11px] leading-relaxed"
              >
                {b.text}
              </pre>
            );
          if (b.kind === "quote")
            // tappable highlighted passage → opens comments, like a selection in the real doc
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPanel("cm")}
                className="my-2 block w-full rounded-sm bg-mark px-0.5 text-left text-[12.5px] leading-relaxed shadow-[0_-1px_0_0_var(--mark-line)_inset]"
              >
                {b.text}
              </button>
            );
          return (
            <p key={i} className="my-2 text-[12.5px] leading-relaxed text-foreground/90">
              {b.text}
            </p>
          );
        })}
      </div>

      {/* floating bottom pill — the phone's Contents / Comments controls */}
      <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center">
        <div className="flex items-center gap-1 rounded-full border border-border bg-popover p-1 shadow-lg">
          <Button size="sm" variant="ghost" className="rounded-full text-[11px]" onClick={() => setPanel("toc")}>
            {dict.sheetToc}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-[11px]"
            onClick={() => setPanel("cm")}
          >
            {dict.sheetComments}
            {comments.length > 0 && (
              <span className="rounded-full bg-primary-soft px-1.5 text-[9.5px] font-semibold text-primary">
                {comments.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {panel === "toc" && (
        <BottomPanel maxH="max-h-[75%]" title={dict.sheetToc} onClose={() => setPanel(null)}>
          <ul className="space-y-2 text-[12.5px]">
            {dict.doc.toc.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => setPanel(null)} className="text-primary">
                  {t}
                </button>
              </li>
            ))}
          </ul>
        </BottomPanel>
      )}
      {panel === "cm" && (
        <BottomPanel maxH="max-h-[80%]" title={dict.commentsHeading} onClose={() => setPanel(null)}>
          <ul className="space-y-3">
            {comments.map((c, i) => (
              <li key={i} className={c.resolved ? "opacity-50" : ""}>
                <div className="text-[10px] text-muted-foreground">
                  {c.author} · {c.time}
                </div>
                <div className="text-[12.5px] leading-relaxed">{c.body}</div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={dict.replyPlaceholder}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-ring/50"
            />
            <Button size="sm" className="text-[11px]" onClick={send}>
              {dict.replySend}
            </Button>
          </div>
        </BottomPanel>
      )}
    </div>
  );
}
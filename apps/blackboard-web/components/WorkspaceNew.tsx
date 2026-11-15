"use client";

import Link from "next/link";

/**
 * The phone's New tab. TODO(JW-370): no server-side "new document" entry exists yet — the card is
 * the placeholder the brief asks for, pointing at Sessions until that API lands.
 */
export function WorkspaceNew() {
  return (
    <section data-testid="rw-new" className="flex min-h-0 min-w-0 flex-col md:hidden">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <div className="border-border bg-card mb-1 grid size-[34px] place-items-center rounded-[9px] border text-[15px]">＋</div>
        <p className="text-sm font-semibold">New document</p>
        <p className="text-muted-foreground max-w-[250px] text-[12.5px] leading-[1.65]">Creating a document from here is not wired yet. Sessions lists every document the server can open.</p>
        <Link href="/" className="border-border bg-card hover:bg-accent mt-2 flex h-8 items-center rounded-lg border px-3 text-[12.5px]">
          Open Sessions ↗
        </Link>
      </div>
    </section>
  );
}

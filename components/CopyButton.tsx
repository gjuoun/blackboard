"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const FEEDBACK_MS = 1200;

/**
 * Copies `value` on click, and shows a check for a moment. The 32px hit area overhangs a 24px chip,
 * so the chip keeps its height and the touch target stays comfortable on mobile.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    if (!(await copyText(value))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-copied={copied || undefined}
      className={cn(
        "-my-1 -mr-1.5 inline-flex size-8 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors [&>svg]:size-3",
        "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        copied && "text-primary",
      )}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </button>
  );
}

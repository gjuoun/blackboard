import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

type Tone = "default" | "muted" | "accent";

const tones: Record<Tone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  accent: "border-primary/50 bg-primary-soft text-foreground [&>svg]:text-primary",
};

/**
 * One doc-header chip: an icon and text, and an optional copy button. Every chip is 24px high with the same
 * radius, padding and icon size. `className` lets the location chip shrink; the others hold their width.
 */
export function DocChip({
  testid,
  title,
  tone = "default",
  className,
  copy,
  children,
}: {
  testid: string;
  title: string;
  tone?: Tone;
  className?: string;
  copy?: { value: string; label: string };
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      title={title}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 font-mono font-normal whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
        copy && "pr-1",
        tones[tone],
        className,
      )}
    >
      {children}
      {copy ? <CopyButton value={copy.value} label={copy.label} /> : null}
    </div>
  );
}

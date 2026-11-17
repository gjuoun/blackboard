/** The two stacks the app reads and the size ladder it renders them at. */
const STACKS = [
  { name: "--font-ui", label: "Interface", className: "font-sans" },
  { name: "--font-read", label: "Reading", className: "reading-specimen" },
  { name: "--font-code", label: "Code", className: "font-mono" },
] as const;

const SIZES = [
  { name: "text-3xl", px: "30px", className: "text-3xl" },
  { name: "text-2xl", px: "24px", className: "text-2xl" },
  { name: "text-xl", px: "20px", className: "text-xl" },
  { name: "text-lg", px: "18px", className: "text-lg" },
  { name: "text-base", px: "16px", className: "text-base" },
  { name: "text-sm", px: "14px", className: "text-sm" },
  { name: "text-xs", px: "12px", className: "text-xs" },
] as const;

export function TypeSection() {
  return (
    <section
      id="typography"
      className="flex scroll-mt-6 flex-col gap-5 rounded-xl border border-border bg-card p-5 text-card-foreground"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Typography</h2>
        <p className="max-w-[62ch] text-sm text-muted-foreground">
          Three stacks: the chrome, the document body, and code. The reading stack is what a plan is set in;
          the interface stack never reaches the prose.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        {STACKS.map((stack) => (
          <div
            key={stack.name}
            className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
          >
            <p className="font-mono text-[11px] text-muted-foreground">{stack.name}</p>
            <p className={stack.className + " text-lg text-foreground"}>
              {stack.label} — The quick brown fox jumps over the lazy dog, 0123456789.
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">scale</p>
        {SIZES.map((size) => (
          <div key={size.name} className="flex items-baseline gap-3">
            <code className="w-[5.5rem] shrink-0 font-mono text-[11px] text-muted-foreground">
              {size.name}
            </code>
            <span className="w-[3rem] shrink-0 font-mono text-[11px] text-muted-foreground">{size.px}</span>
            <span className={size.className + " text-foreground"}>Blackboard</span>
          </div>
        ))}
      </div>
    </section>
  );
}

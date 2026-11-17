import type { Mode, ThemeId } from "@gjuoun/bb-ui/themes";
import type { ReactNode } from "react";

interface Props {
  theme?: ThemeId;
  mode?: Mode;
  children: ReactNode;
}

// CSS phone shell. The inner stage carries its own data-theme/data-mode so a palette change
// inside the demo never leaks to the page — the attribute-scoped theme blocks resolve per root.
export function PhoneFrame({ theme = "warm", mode = "light", children }: Props) {
  return (
    <div className="mx-auto w-[320px] select-none">
      <div className="rounded-[44px] border border-border bg-foreground/90 p-[10px] shadow-xl">
        <div
          data-theme={theme}
          data-mode={mode}
          data-slot="phone-stage"
          className="relative h-[560px] overflow-hidden rounded-[34px] bg-background text-foreground"
        >
          {/* status bar */}
          <div className="flex items-center justify-between px-6 pt-2 text-[10px] font-semibold">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded-[2px] border border-current" />
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
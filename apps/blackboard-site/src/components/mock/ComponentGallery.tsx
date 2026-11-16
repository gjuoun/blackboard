import { useState } from "react";
import { Badge } from "@gjuoun/bb-ui/components/ui/badge";
import { Button } from "@gjuoun/bb-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gjuoun/bb-ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@gjuoun/bb-ui/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@gjuoun/bb-ui/components/ui/sheet";
import { applyTheme, MODES, THEMES, type Mode, type ThemeId } from "@gjuoun/bb-ui/themes";

const buttonVariants = ["default", "secondary", "outline", "ghost", "link", "destructive"] as const;
const buttonSizes = ["lg", "default", "sm", "xs"] as const;
const badgeVariants = ["default", "secondary", "destructive", "outline"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default function ComponentGallery() {
  const [theme, setTheme] = useState<ThemeId>("warm");
  const [mode, setMode] = useState<Mode>("light");
  const [checked, setChecked] = useState(true);
  const [sheetOpen, setSheetOpen] = useState<"bottom" | "right" | null>(null);

  const pick = (t: ThemeId, m: Mode) => {
    setTheme(t);
    setMode(m);
    applyTheme(document.documentElement, t, m);
  };

  return (
    <div className="min-h-dvh bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-2xl font-bold">bb-ui component mock</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every stock component in packages/bb-ui, under each palette.
            </p>
          </div>
          <div className="flex gap-2">
            {THEMES.map((t) =>
              MODES.map((m) => (
                <Button
                  key={`${t.id}-${m}`}
                  size="sm"
                  variant={theme === t.id && mode === m ? "default" : "outline"}
                  onClick={() => pick(t.id, m)}
                >
                  {t.label} {m}
                </Button>
              )),
            )}
          </div>
        </header>

        <Section title="Button">
          {buttonVariants.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </Section>

        <Section title="Button sizes">
          {buttonSizes.map((s) => (
            <Button key={s} size={s}>
              size {s}
            </Button>
          ))}
          <Button size="icon" aria-label="icon button">
            ★
          </Button>
        </Section>

        <Section title="Badge">
          {badgeVariants.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </Section>

        <Section title="Dropdown menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Document</DropdownMenuLabel>
              <DropdownMenuItem>Open comments</DropdownMenuItem>
              <DropdownMenuItem>Copy link</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>
                Mark unread
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        <Section title="Popover">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <p className="text-sm">
                A palette and font picker would live here — same slot as ReadingSettings in the
                app.
              </p>
            </PopoverContent>
          </Popover>
        </Section>

        <Section title="Sheet">
          <Button variant="outline" onClick={() => setSheetOpen("bottom")}>
            Bottom sheet
          </Button>
          <Button variant="outline" onClick={() => setSheetOpen("right")}>
            Right sheet
          </Button>
          <Sheet open={sheetOpen !== null} onOpenChange={(o) => !o && setSheetOpen(null)}>
            <SheetContent side={sheetOpen ?? "bottom"} className="p-6">
              <SheetTitle>Comments</SheetTitle>
              <SheetDescription>
                This is how the comments panel reaches the phone — a bottom sheet, 80vh max.
              </SheetDescription>
            </SheetContent>
          </Sheet>
        </Section>

        <Section title="Token check">
          <div className="grid w-full grid-cols-4 gap-2 text-xs">
            {(["primary", "secondary", "muted", "accent", "card", "background", "destructive", "popover"] as const).map(
              (r) => (
                <div key={r} className="overflow-hidden rounded-md border border-border">
                  <div className="h-10" style={{ background: `var(--${r})` }} />
                  <div className="px-2 py-1 text-muted-foreground">{r}</div>
                </div>
              ),
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
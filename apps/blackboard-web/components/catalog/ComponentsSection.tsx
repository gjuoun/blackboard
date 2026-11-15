"use client";

import { Badge } from "@gjuoun/bb-ui/components/ui/badge";
import { Button } from "@gjuoun/bb-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gjuoun/bb-ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@gjuoun/bb-ui/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@gjuoun/bb-ui/components/ui/sheet";
import { useState } from "react";
import { CATEGORIES } from "./catalog-data";

/** One heading style for every group inside a card, so the five cards read the same way. */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Card({ id, title, source, children }: { id: string; title: string; source: string; children: React.ReactNode }) {
  return (
    <div id={id} data-component={id} className="flex scroll-mt-[calc(var(--bar-h)+16px)] flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <code className="font-mono text-[11px] text-muted-foreground">{source}</code>
      </header>
      {children}
    </div>
  );
}

/** The sheet has no trigger of its own — the app drives it with `open`, so the catalogue does too. */
function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" data-opener="sheet" onClick={() => setOpen(true)}>
        Open sheet
      </Button>
      <SheetContent data-opened>
        <SheetTitle>A sheet</SheetTitle>
        <SheetDescription>The side panel the document view uses for comments.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;
const BADGE_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

/** The five components the package ships, each with every variant it declares and a live example. */
export function ComponentsSection() {
  return (
    <div className="flex flex-col gap-8">
      {CATEGORIES.map((category) => (
        <section key={category.id} id={"cat-" + category.id} className="flex scroll-mt-6 flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">{category.title}</h2>

          {category.id === "actions" && (
            <Card id="button" title="Button" source={category.components[0].source}>
              <Group label="Variants">
                {BUTTON_VARIANTS.map((variant) => (
                  <Button key={variant} variant={variant}>
                    {variant}
                  </Button>
                ))}
              </Group>
              <Group label="Sizes">
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} size={size}>
                    {size}
                  </Button>
                ))}
              </Group>
              <Group label="States">
                <Button disabled>disabled</Button>
                <Button variant="outline" disabled>
                  outline disabled
                </Button>
              </Group>
            </Card>
          )}

          {category.id === "data" && (
            <Card id="badge" title="Badge" source={category.components[0].source}>
              <Group label="Variants">
                {BADGE_VARIANTS.map((variant) => (
                  <Badge key={variant} variant={variant}>
                    {variant}
                  </Badge>
                ))}
              </Group>
              <Group label="Examples">
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge>3 open</Badge>
                  <Badge variant="secondary">draft</Badge>
                  <Badge variant="outline">main</Badge>
                </span>
              </Group>
            </Card>
          )}

          {category.id === "overlays" && (
            <>
              <Card id="dropdown-menu" title="Dropdown menu" source={category.components[0].source}>
                <Group label="Live">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" data-opener="dropdown-menu">
                        Open menu
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" data-opened>
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem>Copy link</DropdownMenuItem>
                      <DropdownMenuItem>Rename</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Group>
              </Card>

              <Card id="popover" title="Popover" source={category.components[1].source}>
                <Group label="Live">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" data-opener="popover">
                        Open popover
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" data-opened>
                      <p className="text-sm text-foreground">A popover paints on the same palette as the page.</p>
                      <p className="mt-1 text-xs text-muted-foreground">Its surface is the card colour, its text the foreground.</p>
                    </PopoverContent>
                  </Popover>
                </Group>
              </Card>

              <Card id="sheet" title="Sheet" source={category.components[2].source}>
                <Group label="Live">
                  <SheetDemo />
                </Group>
              </Card>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ORDER } from "@/components/catalog/catalog-data";
import { BLOCKS } from "@gjuoun/bb-ui/themes/palette";
import UiPage, { metadata } from "./page";

const count = (html: string, needle: string) => html.split(needle).length - 1;

test("ui catalogue: the page is unlisted", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

test("ui catalogue: four palette blocks, every role, painted by its own token", () => {
  const html = renderToStaticMarkup(<UiPage />);
  // One block at a time (the selectors pick it), and only Blackboard's own tokens — the nine
  // shadcn aliases are not rows.
  expect(count(html, "data-block=")).toBe(1);
  expect(count(html, "data-swatch")).toBe(20);
  expect(count(html, "data-theme-select")).toBe(1);
  expect(count(html, "data-mode-select")).toBe(1);
  for (const alias of ["card-foreground", "popover-foreground", "secondary-foreground", "muted", "input", "ring"]) {
    expect({ alias, shown: html.includes('data-role="' + alias + '"') }).toEqual({ alias, shown: false });
  }
  // The swatch is the token; the caption is the expanded value. Both are on the page.
  expect(html).toContain("var(--theme-primary)");
  // The default block is warm/light; the selectors swap it (proved in the browser drive).
  expect(html).toContain('data-hex="' + BLOCKS.warm.light.primary + '"');
  expect(html).toContain('data-block="warm/light"');
});

test("ui catalogue: every rail anchor is a section on the page", () => {
  const html = renderToStaticMarkup(<UiPage />);
  for (const id of ORDER) expect({ id, found: html.includes('id="' + id + '"') }).toEqual({ id, found: true });
});

test("ui catalogue: the five stock components are shown", () => {
  const html = renderToStaticMarkup(<UiPage />);
  for (const id of ["button", "dropdown-menu", "popover", "sheet", "badge"]) {
    expect({ id, shown: html.includes('data-component="' + id + '"') }).toEqual({ id, shown: true });
  }
});
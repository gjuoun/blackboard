/**
 * The catalogue's sections and components, in page order. The rail and the page both read this, so
 * the navigation cannot list a section the page does not render.
 */
export interface CatalogEntry {
  id: string;
  title: string;
  /** The file the component comes from, shown under its heading. */
  source: string;
}

export interface CatalogCategory {
  id: string;
  title: string;
  components: CatalogEntry[];
}

export const TOP_SECTIONS = [
  { id: "colour", title: "Colour" },
  { id: "typography", title: "Typography" },
] as const;

/** The five components `@gjuoun/bb-ui` ships, grouped the way the stock library groups them. */
export const CATEGORIES: CatalogCategory[] = [
  {
    id: "actions",
    title: "Actions",
    components: [{ id: "button", title: "Button", source: "components/ui/button.tsx" }],
  },
  {
    id: "overlays",
    title: "Overlays",
    components: [
      { id: "dropdown-menu", title: "Dropdown menu", source: "components/ui/dropdown-menu.tsx" },
      { id: "popover", title: "Popover", source: "components/ui/popover.tsx" },
      { id: "sheet", title: "Sheet", source: "components/ui/sheet.tsx" },
    ],
  },
  {
    id: "data",
    title: "Data display",
    components: [{ id: "badge", title: "Badge", source: "components/ui/badge.tsx" }],
  },
];

/** Every anchor on the page, in scroll order: the rail's active-section reader walks this. */
export const ORDER: string[] = [
  ...TOP_SECTIONS.map((s) => s.id),
  ...CATEGORIES.flatMap((c) => c.components.map((k) => k.id)),
];
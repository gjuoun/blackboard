import { createFileRoute } from "@tanstack/react-router";
import { CatalogBody } from "@/components/catalog/CatalogBody";
import { CATEGORIES } from "@/components/catalog/catalog-data";
import { Rail } from "@/components/catalog/Rail";

// An internal page: unlisted, and reachable only by typing the URL.
export const Route = createFileRoute("/ui")({
  head: () => ({
    meta: [
      { title: "Component library · Blackboard" },
      { name: "description", content: "Blackboard's own palettes, type scale and stock components, live." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UiPage,
});

function UiPage() {
  const components = CATEGORIES.reduce((total, category) => total + category.components.length, 0);
  return (
    <main className="mx-auto max-w-[1480px] px-6 pt-8 pb-24">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">@gjuoun/bb-ui</p>
        <h1 className="text-3xl font-semibold text-foreground">Component library</h1>
        <p className="max-w-[62ch] text-muted-foreground">
          Blackboard&rsquo;s four palettes, its type scale, and the {components} stock components the theme
          package ships. Every colour below is read from the package and painted with the same tokens the app
          uses, so this page cannot show another theme&rsquo;s hexes.
        </p>
      </header>
      <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:gap-10">
        <Rail />
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <CatalogBody />
        </div>
      </div>
    </main>
  );
}

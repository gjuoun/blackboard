import type { TocEntry } from "@/lib/markdown";

export function Toc({ toc }: { toc: TocEntry[] }) {
  if (toc.length === 0) return null;
  return (
    <nav className="toc" data-testid="toc" aria-label="On this page">
      <h2>On this page</h2>
      <ul>
        {toc.map((t) => (
          <li key={t.id} className={`toc-depth-${t.depth}`}>
            <a href={`#${t.id}`}>{t.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// The landing page as data. One dictionary per locale; the components read only this shape, so a
// new language is a new file here plus a three-line page — no markup is duplicated.

export type Locale = "en" | "zh";

export interface Shot {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  loading?: "lazy";
}

export interface Feature {
  title: string;
  text: string;
}

export interface CliRow {
  /** Everything after the `blackboard` command word, padding included: the block is a <pre>. */
  command: string;
  /** Rendered after a `#`, in the muted colour. */
  comment?: string;
}

export interface Switcher {
  href: string;
  /** The label in the OTHER language, as the page shows it. */
  label: string;
  /** The lang attribute for that label. */
  lang: string;
}

export interface Dict {
  locale: Locale;
  /** The <html lang> value. */
  lang: string;
  title: string;
  description: string;
  /** The language's own name, as the footer prints it. */
  languageName: string;
  switcher: Switcher;
  hero: {
    tagline: string;
    who: string;
    cta: string;
    github: string;
    shot: Shot;
  };
  install: {
    rows: string[];
    copy: string;
    copied: string;
    bunPrefix: string;
    bunCommand: string;
  };
  inbox: { heading: string; shot: Shot };
  features: { heading: string; items: Feature[] };
  cli: {
    heading: string;
    rows: CliRow[];
    note: { before: string; code: string; after: string };
  };
  footer: { license: string; requirements: string };
}

import { defineConfig } from "astro/config";

// One deployment: Cloudflare Pages, project `blackboard`, served from the root of its domain.
// Two locales: English at /, Chinese at /zh/. Adding a locale is a dictionary plus one page.
export default defineConfig({
  trailingSlash: "always",
  build: { format: "directory" },
  server: { port: 4397 },
  preview: { port: 4397 },
  i18n: {
    locales: ["en", "zh"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
});

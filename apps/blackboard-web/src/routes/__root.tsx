import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DEFAULT_MODE, DEFAULT_THEME } from "@gjuoun/bb-ui/themes";
import { TopBar } from "@/components/TopBar";
import { StartNavProvider } from "@/components/nav-start";
import { bootScript } from "@/lib/prefs";
import commentMdCss from "../styles/comment-md.css?url";
import katexCss from "../styles/katex.css?url";
import syntaxCss from "../styles/syntax.css?url";
import tailwindCss from "../styles/tailwind.css?url";

const DESCRIPTION =
  "Read markdown plans in the browser and comment on the text, so you and a coding agent can go back and forth on them.";

/**
 * The shell Next's `app/layout.tsx` provided: the document, the four stylesheets in cascade order,
 * the pre-paint boot script, and the top bar. `data-theme`/`data-mode` are the server fallback; the
 * script reads the stored record before the first paint and sets the real palette, so React must
 * not "fix" the <html> attributes back for a frame — hence suppressHydrationWarning.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // `cover` lets the phone's bars use the safe-area insets (env()); desktop has none.
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Blackboard" },
      { name: "description", content: DESCRIPTION },
      { name: "application-name", content: "Blackboard" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Blackboard" },
      { property: "og:title", content: "Blackboard" },
      { property: "og:description", content: DESCRIPTION },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Blackboard" },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [
      { rel: "stylesheet", href: tailwindCss },
      { rel: "stylesheet", href: katexCss },
      { rel: "stylesheet", href: syntaxCss },
      { rel: "stylesheet", href: commentMdCss },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} data-mode={DEFAULT_MODE} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
        <HeadContent />
      </head>
      <body>
        <StartNavProvider>
          <TopBar />
          {children}
        </StartNavProvider>
        <Scripts />
      </body>
    </html>
  );
}
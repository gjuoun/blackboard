import type { Metadata } from "next";
import { TopBar } from "@/components/TopBar";
import { bootScript } from "@/lib/prefs";
import { DEFAULT_THEME } from "@/lib/theme";
import "./globals.css";
import "./katex.css";

const DESCRIPTION = "Read markdown plans in the browser and comment on the text, so you and a coding agent can go back and forth on them.";

export const metadata: Metadata = {
  // Absolute URLs for the share images; set BLACKBOARD_URL when the app is reachable from outside.
  metadataBase: new URL(process.env.BLACKBOARD_URL ?? `http://127.0.0.1:${process.env.PORT ?? 38770}`),
  title: { default: "Blackboard", template: "%s · Blackboard" },
  description: DESCRIPTION,
  applicationName: "Blackboard",
  openGraph: { type: "website", siteName: "Blackboard", title: "Blackboard", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Blackboard", description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is the server fallback; the inline script reads the stored record before the first
    // paint and sets the real palette, the dark class, the font attributes and both panel widths.
    // Suppressing the hydration warning is what lets that happen without React "fixing" the <html>
    // attributes back to the fallback for a frame.
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
      </head>
      <body>
        <TopBar />
        {children}
      </body>
    </html>
  );
}

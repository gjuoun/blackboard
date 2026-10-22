import type { Metadata } from "next";
import { TopBar } from "@/components/TopBar";
import { DEFAULT_THEME } from "@/lib/theme";
import "./globals.css";

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
    <html lang="en" data-theme={DEFAULT_THEME}>
      <body>
        <TopBar />
        {children}
      </body>
    </html>
  );
}

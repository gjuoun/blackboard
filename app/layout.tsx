import type { Metadata } from "next";
import { TopBar } from "@/components/TopBar";
import { DEFAULT_THEME } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blackboard",
  description: "Read planning docs and comment on them",
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

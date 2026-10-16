import type { Metadata } from "next";
import { TabStrip } from "@/components/TabStrip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blackboard",
  description: "Read planning docs and comment on them",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <TabStrip />
        {children}
      </body>
    </html>
  );
}

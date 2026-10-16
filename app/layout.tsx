import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blackboard",
  description: "Read planning docs and comment on them",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

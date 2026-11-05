import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resource Hub",
  description: "A headless WordPress demo front end built with Next.js.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

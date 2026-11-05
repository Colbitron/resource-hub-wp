import type { Metadata } from "next";

import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: {
    default: "Resource Hub",
    template: "%s | Resource Hub",
  },
  description: "A filterable library of resources: guides, webinars, reports and more, modelled in WordPress and rendered by Next.js.",
};

// No stylesheet is imported here: the shell imports the shared tokens and its
// own styles, so every page gets them through the component that uses them
// (ADR 0045).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

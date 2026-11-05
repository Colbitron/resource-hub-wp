import type { Metadata } from "next";

import { Shell } from "@/components/Shell";
import { siteUrl } from "@/lib/env";

/**
 * The site-wide metadata. `metadataBase` is the public origin from the
 * server-only `SITE_URL`, so every page's canonical `link`, `og:url` and
 * `og:image`, which the pages set as root-relative paths, render absolute on
 * the public domain (ADR 0050's 2026-11-05 amendment). Unset, as in local
 * work, they stay relative; a Vercel build refuses to run without it
 * (`next.config.ts`). A function rather than a constant so the variable is
 * read when a page renders, not when the module is imported.
 */
export function generateMetadata(): Metadata {
  const base = siteUrl();
  return {
    ...(base === undefined ? {} : { metadataBase: base }),
    title: {
      default: "Resource Hub",
      template: "%s | Resource Hub",
    },
    description: "A filterable library of resources: guides, webinars, reports and more, modelled in WordPress and rendered by Next.js.",
  };
}

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

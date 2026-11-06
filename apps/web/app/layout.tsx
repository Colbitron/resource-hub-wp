import type { Metadata } from "next";

import { Shell } from "@/components/Shell";
import { siteUrl } from "@/lib/env";

/**
 * The site-wide metadata. `metadataBase` is the public origin from the
 * server-only `SITE_URL`, so every page's canonical `link`, `og:url` and
 * `og:image`, which the pages set as root-relative paths, render absolute on
 * the public domain (see `apps/web/README.md`). Unset, as in local work, they
 * stay relative; a Vercel build refuses to run without it (`next.config.ts`). A
 * function rather than a constant so the variable is read when a page renders,
 * not when the module is imported. It sets no `openGraph` or `twitter`:
 * segments merge shallowly, so either would reach every page that sets none,
 * and an inherited `twitter.card` would outlive a page's image
 * (`lib/share-metadata.ts`).
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
// (the rule is in `apps/web/CLAUDE.md`).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

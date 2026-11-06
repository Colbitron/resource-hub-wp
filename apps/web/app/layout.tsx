import type { Metadata } from "next";

import { Shell } from "@/components/Shell";
import { siteUrl } from "@/lib/env";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

import { figtree } from "./fonts";

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
// (`packages/ui/DESIGN.md`). The font is the one exception, because its
// variable has to be set on <html>: `tokens.css` reads `--rh-font-figtree`
// where it declares `--rh-font-sans`, on `:root`, so a class lower down the
// tree would never reach it; and a font applied by the root layout is
// preloaded on every route (app/fonts.ts).
//
// The one script in <head> is the theme's first paint (lib/theme.ts): it
// reads the stored choice and sets `data-theme` on <html> as the browser
// parses, before anything is painted and before any bundle loads, so a
// reader who chose Dark never sees a light flash. Pages are static and
// ISR-cached, so this is the only place the choice can be read without
// making every page dynamic. React then hydrates an <html> whose attributes
// differ from the markup it rendered; `suppressHydrationWarning` on that one
// element, and no other, tells it to keep the DOM's
// (test/hydration-warning.test.ts holds that). The theme control
// (components/ThemeToggle.tsx) re-applies the attribute after hydration as a
// guard: the Next.js guide warns that development's Strict Mode remount can
// reset it; not reproduced on Next.js 16.4.5 with React 19.3.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

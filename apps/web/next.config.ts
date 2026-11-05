import type { NextConfig } from "next";

import { optionalMediaOrigin } from "./lib/env-schema";

// create-next-app 16 enables Cache Components by default. This project uses the
// classic App Router caching shape that CLAUDE.md specifies (fetch with
// `next: { tags }`, a long route `revalidate`, and `revalidateTag`), so the
// flags are left off. The choice is recorded in ADR 0043.
const nextConfig: NextConfig = {
  // Every public URL ends in a slash, the same as the CMS's permalinks
  // (ADRs 0024, 0034).
  trailingSlash: true,

  // next/image optimises only same-origin /media/… sources, which the rewrite
  // below maps to the CMS's uploads; the CMS host is never a remote pattern
  // (ADRs 0039, 0040). Next.js adds /_next/static/media/** for static imports
  // itself. `search: ""` refuses query strings, so no one can vary the URL to
  // spend the optimiser's allowance.
  images: {
    localPatterns: [{ pathname: "/media/**", search: "" }],
  },

  // /media/… is the CMS's uploads directory, one to one (ADR 0040). The origin
  // is WP_MEDIA_ORIGIN, or the origin of WP_API_URL, read when the routes are
  // built. Next.js also loads this file for `next typegen`, which needs no
  // CMS, so with neither set the rewrite is left out with a warning; a page
  // that fetches from the CMS still fails by name. A malformed value throws.
  async rewrites() {
    const origin = optionalMediaOrigin(process.env);
    if (origin === undefined) {
      console.warn(
        "WP_API_URL and WP_MEDIA_ORIGIN are not set: /media/ is not rewritten to the CMS.",
      );
      return [];
    }
    return [
      {
        source: "/media/:path*",
        destination: `${origin}/wp-content/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;

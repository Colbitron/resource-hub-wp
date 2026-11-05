import type { NextConfig } from "next";

import { mediaRewrites } from "./lib/media-rewrites";

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

  // /media/… is the CMS's uploads directory, one to one (ADR 0040); see
  // lib/media-rewrites.ts for the base it maps to and when it is left out.
  // The CMS's response headers pass through this rewrite: ADR 0040's
  // 2026-11-05 amendment records that and the pending alternative.
  async rewrites() {
    return mediaRewrites(process.env);
  },
};

export default nextConfig;

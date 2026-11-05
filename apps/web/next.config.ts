import type { NextConfig } from "next";

import { buildSiteUrl } from "./lib/env-schema";
import { mediaRewrites } from "./lib/media-rewrites";

// SITE_URL, the public origin the root layout gives `metadataBase`, is
// checked when the config loads: a malformed value fails every build, and an
// unset one fails a Vercel build, so no deploy publishes a relative canonical
// (lib/env-schema.ts, ADR 0050's 2026-11-05 amendment). The layout reads it
// again at render time through lib/env.ts.
buildSiteUrl(process.env);

// create-next-app 16 enables Cache Components by default. This project uses the
// classic App Router caching shape that CLAUDE.md specifies (fetch with
// `next: { tags }`, a long route `revalidate`, and `revalidateTag`), so the
// flags are left off. The choice is recorded in ADR 0043.
const nextConfig: NextConfig = {
  // Test-only pages are named `page.fixture.tsx` and become routes only when
  // RH_FIXTURES is set, as Playwright's web server sets it: a production build
  // never includes them. Playwright's e2e/*.spec.ts render app/fixtures/.
  pageExtensions: [
    ...(process.env.RH_FIXTURES === "1" ? ["fixture.tsx"] : []),
    "tsx",
    "ts",
  ],

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

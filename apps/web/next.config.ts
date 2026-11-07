import type { NextConfig } from "next";

import { buildSiteUrl } from "./lib/env-schema";
import { mediaRewrites } from "./lib/media-rewrites";
import { routeHeaders } from "./lib/route-headers";

// SITE_URL, the public origin the root layout gives `metadataBase`, is
// checked when the config loads: a malformed value fails every build, and an
// unset one fails a Vercel build, so no deploy publishes a relative canonical
// (lib/env-schema.ts; apps/web/README.md has the variable's rules). The layout
// reads it again at render time through lib/env.ts.
buildSiteUrl(process.env);

// create-next-app 16 enables Cache Components by default. This project uses the
// classic App Router caching shape (fetch with `next: { tags }`, a long route
// `revalidate`, and `revalidateTag`), so the flags are left off: the fetch Data
// Cache persists across deployments and instances, while `'use cache'` keeps
// its entries in memory unless a paid remote cache is added (ADR 0043).
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
  // (ADR 0024).
  trailingSlash: true,

  // Every route's CSS, about 6 KB compressed, ships inline in <head> rather
  // than as five render-blocking files. On a page whose LCP is an image,
  // Lighthouse's simulation charges every request that finished before the
  // image painted, including the framework's scripts, and the five files held
  // the browser's connections while those scripts waited. Inline, the scripts
  // start with the CSS, and the simulated LCP of both image-led sampled pages
  // and every page's FCP fall by about 150 and 280 ms. The cost is CSS a
  // returning reader cannot cache apart from the HTML, and a second copy of it
  // in the RSC payload; a client navigation still uses <link> tags.
  // apps/web/README.md, "Images", has the measurements.
  experimental: { inlineCss: true },

  // next/image optimises only same-origin /media/… sources, which the rewrite
  // below maps to the CMS's uploads; the CMS host is never a remote pattern, so
  // no image request names it (ADR 0040; apps/web/README.md has the images
  // setup). Next.js adds /_next/static/media/** for static imports itself.
  // `search: ""` refuses query strings, so no one can vary the URL to spend the
  // optimiser's allowance.
  images: {
    localPatterns: [{ pathname: "/media/**", search: "" }],
  },

  // /media/… is the CMS's uploads directory, one to one (ADR 0040); see
  // lib/media-rewrites.ts for the base it maps to and when it is left out.
  // The CMS's response headers pass through this rewrite, and some of them
  // name or fingerprint the CMS; the alternative, a Route Handler that copies
  // an allow-list of headers, is open in issue #52.
  async rewrites() {
    return mediaRewrites(process.env);
  },

  // The single-resource route and the pages catch-all are ISR and store their
  // computed 308s like their 200s (ADRs 0025 and 0052; see
  // docs/architecture/caching.md). Next.js sends a stored response with
  // `s-maxage` only, which a browser ignores, and Chromium keeps a 308 with no
  // `max-age` for ever (ADR 0025), which no revalidation can undo. These rules
  // put the header Vercel's CDN sends browsers anyway on every response of the
  // two routes, so under `next start` too a browser asks again each time;
  // Next.js keeps it on an ISR response rather than its own (`sendRenderResult`
  // sets `Cache-Control` only when none is set) and still answers from its
  // route cache. The listings keep Next.js's header: their only redirects come
  // from `proxy.ts`. See lib/route-headers.ts for the rules and their tests.
  async headers() {
    return routeHeaders();
  },
};

export default nextConfig;

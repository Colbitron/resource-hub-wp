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

  // Every route's CSS ships inline in <head> rather than as five
  // render-blocking files: on the harness's build the library's <style> is
  // 15,238 bytes raw and 3,173 gzipped, the resource page's 15,581 and 3,296,
  // and a CMS page's 12,741 and 2,912. On a page whose LCP is an image,
  // Lighthouse's simulation charges every request that finished before the
  // image painted, including the framework's scripts, and the five files held
  // the browser's connections while those scripts waited. Inline, the scripts
  // start with the CSS, and the simulated LCP of both image-led sampled pages
  // and every page's FCP fall by about 150 and 280 ms. The cost is CSS a
  // returning reader cannot cache apart from the HTML, and a second copy of it
  // in the RSC payload; a client navigation still uses <link> tags. Both
  // copies count against the 14,600 bytes of HTML Lighthouse's simulated
  // connection sends in its first round trip, and a page over that pays
  // 150 ms more FCP and LCP, so a component imports only the CSS it renders.
  // apps/web/README.md, "Images", has the measurements.
  //
  // The flag is experimental and acts only in a production build, so a
  // `next dev` page is no evidence either way. On any Next.js upgrade, re-run
  // `pnpm web:test:lighthouse` and read the built HTML's <head>. If the flag
  // stops inlining, e2e/harness.spec.ts ("the CSS ships inline in <head>, not
  // as stylesheet links") fails on the harness's production build.
  experimental: {
    inlineCss: true,

    // The client router's route prediction is off. With it on (the default),
    // once the router has learned the library's route tree, the optional
    // catch-all `app/resources/[[...rest]]`, it predicts every link under
    // `/resources/` whose first segment is not a static sibling (`topic`,
    // `page`) as a path of that catch-all, the only dynamic child it knows
    // there, and prefetches the row's and the type listing's page segment
    // under the catch-all's segment key, which the server answers 404: a
    // console error per link, nothing prefetched, and a full fetch on the
    // click. Whether it happens is a race between the library's own tree
    // response and the links' prefetch tasks, measured both ways on Next.js
    // 16.4.5 (`docs/architecture/caching.md`, "Prefetching"). Without
    // prediction every link asks the server for its own route tree, about
    // 0.7 KB, and prefetches the right segments; `e2e/prefetch.spec.ts`
    // fails on a request under the catch-all's key. The flag is experimental
    // and undocumented; if an upgrade drops it, that spec is what notices.
    optimisticRouting: false,
  },

  // next/image optimises only same-origin /media/… sources, which the rewrite
  // below maps to the CMS's uploads; the CMS host is never a remote pattern, so
  // no image request names it (ADR 0040; apps/web/README.md has the images
  // setup). Next.js adds /_next/static/media/** for static imports itself.
  // `search: ""` refuses query strings, so no one can vary the URL to spend the
  // optimiser's allowance.
  //
  // AVIF only: the library's 1600×900 lead photograph is 18 KB as the
  // 750-wide AVIF a phone gets against 31 KB as WebP, at the same default
  // quality of 75 (Next.js scales AVIF's encoder quality to match WebP's
  // look), with no visible difference at 360 or 1280 px. On Lighthouse's
  // simulated slow 4G that is about 140 ms of the library's LCP. A lower
  // `quality` on the lead alone was tried first: WebP at 65 saved 3 KB and no
  // LCP, and WebP reaches AVIF's 18 KB only at about 35, which smears the
  // photograph's texture into blocks. A browser whose `Accept` names no AVIF
  // gets a still image resized and re-encoded at the same quality, as JPEG
  // when the source is WebP or AVIF and in the source's own format otherwise
  // (a JPEG stays a JPEG, a PNG a PNG), never as WebP:
  // `imageOptimizerTransform` in
  // `next/dist/server/image-optimizer/transform.js` (Next.js 16.4.5)
  // downgrades a still WebP or AVIF to JPEG when no configured format
  // matched, where the `images.formats` docs say only "the original format".
  // An animated WebP, PNG or GIF, a BMP, HEIC, ICO, ICNS or JXL, and an image
  // the encoder fails on reach every browser as they are. A browser without
  // AVIF downloads more, which is the trade the single format makes. The
  // costs are on Vercel: AVIF encodes more slowly, so the first request for
  // each width waits longer until the optimiser has cached it. The
  // optimiser's cache key includes the output format, so each width of an
  // image is one AVIF transformation against the plan's allowance, and a
  // second only if a browser without AVIF asks for that width, where two
  // formats made it two whenever both kinds of browser came
  // (apps/web/README.md, "Images").
  images: {
    localPatterns: [{ pathname: "/media/**", search: "" }],
    formats: ["image/avif"],
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

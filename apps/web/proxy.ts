import { NextResponse, type NextRequest } from "next/server";

import { decidePath, NOT_FOUND_ROUTE } from "./lib/path-decision";
import { REVALIDATE_EACH_TIME } from "./lib/route-headers";

/**
 * What is decided from the path alone, before any route runs
 * (`lib/path-decision.ts`): a canonical-form redirect, or the not-found
 * page's HTML for a path that can only be a 404.
 *
 * The redirect (`lib/canonical-path.ts`): an upper-case letter in any
 * segment, or a trailing `/page/1/` on a listing, gets one 308 to the
 * canonical path with `Cache-Control: no-store` (ADR 0025; see
 * `docs/architecture/caching.md`). The listings' redirects are here and not
 * in the pages because a `permanentRedirect()` from an ISR page is stored,
 * and the rule covers every path because the resource page and the pages
 * catch-all are ISR too, and Next.js's stored entry is keyed by the decoded
 * path, which a case-insensitive file system shares between `/About/` and
 * `/about/`, so a mixed-case request that reached either route first would
 * store a redirect at the canonical path's own key. A proxy redirect with no
 * data costs about a fifth of a millisecond, and the proxy adds about a
 * tenth of one to every other matched request; the matcher below keeps
 * ASCII canonical page paths out of it (a percent-encoded one runs it, for
 * nothing: see the matcher).
 *
 * The 404 (issue #46): a path no route could answer with anything but a
 * 404, decided by the routes' own checks, is rewritten to `/404` with status
 * 404 (`NOT_FOUND_ROUTE` in `lib/path-decision.ts`), which serves the
 * prerendered `app/not-found.tsx`. It was first the one way to put that page
 * in a 404's HTML, since a `notFound()` thrown by a page outside any
 * Suspense boundary sends Next.js 16.4.5's empty `__next_error__` document
 * (`docs/architecture/caching.md`, "Not-found pages"). The routes now put it
 * there themselves for the 404s they decide from data
 * (`components/DataNotFound.tsx`), and the rewrite stays for what it saves:
 * a junk URL renders no page and stores no entry of its own, so a scanner's
 * thousand paths share one cached copy rather than filling the route cache.
 * The rewrite is internal (the browser keeps its URL), and the response
 * carries the `Cache-Control` every other 404 of the app's routes carries
 * (`lib/route-headers.ts`, ADR 0025): a browser asks again each time, and
 * nothing here outlives a deploy that adds a route.
 * Measured 2026-11-06 on the two servers the app runs on, which differ:
 *
 * - Under `next start`, `/404` is the pathname the server treats as its
 *   404 page: it answers with the prerendered not-found page, status 404
 *   and `noindex` set by the server, and one route-cache entry shared by
 *   every junk URL (an
 *   `x-nextjs-cache: HIT` on a URL never asked for before, where the
 *   catch-all's `notFound()` stored one entry per URL). The response's own
 *   header would be `s-maxage=31536000` alone, hence the one set here. The
 *   App Router's `/_not-found` behaves the same here, and was the target
 *   first; `e2e/errors.spec.ts` pins all of this.
 * - On Vercel, `/404` is the static `404.html` its Next.js builder writes
 *   from the same prerender and serves for its own 404s. The CDN serves it
 *   for every junk URL from one cached copy (`x-matched-path: /404`,
 *   `x-vercel-cache: HIT` on the first request for a new URL), with no
 *   page render and no entry per URL (the proxy itself still runs as a
 *   function on every junk request). Vercel serves a rewritten
 *   response with the status the proxy's response carries, and a static
 *   file has no status of its own, so without `status: 404` the body is
 *   right and the status is 200: a soft 404. A rewrite to `/_not-found`
 *   instead is a prerendered function route there, rendered and stored
 *   once per junk URL (`x-vercel-cache: MISS`, a body that embeds the
 *   URL), with the proxy's 200 unless the status is set, which is why
 *   the target changed. Under `next start` the status is the route's and
 *   the one set here agrees with it.
 *
 * A client-side navigation to a junk URL is the same on both servers: its
 * RSC request gets the 404, the router treats any non-ok response as a
 * full document load (`fetchServerResponse` in Next.js's
 * `router-reducer/fetch-server-response.js`), and that load gets the
 * not-found page's HTML with status 404 at the junk URL.
 *
 * This proxy never reads the data layer: its `fetch` is not the Data Cache's,
 * so a CMS request here would reach the CMS on every matched request. What
 * needs data (an unknown type or topic, a page past the end, a wrong type
 * segment or an old slug on a resource, a wrong parent on a page, a path no
 * page has) is the route's to decide, and the route renders the not-found
 * page into its own 404's HTML (`components/DataNotFound.tsx`), one stored
 * entry per URL.
 *
 * The redirect's target keeps the request's query string. Next.js requires
 * the redirect's URL to be absolute, and then writes a path-only `Location`
 * for one on the request's own origin. Next.js's own trailing-slash 308 runs
 * before this, so a slashless non-canonical path takes two hops (ADR 0025).
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  const decision = decidePath(request.nextUrl.pathname);
  if (decision === null) {
    return undefined;
  }
  const target = request.nextUrl.clone();
  if (decision.kind === "not-found") {
    target.pathname = NOT_FOUND_ROUTE;
    // The not-found page reads nothing, and a client navigation's `_rsc`
    // cache-buster is for the route cache, which this response never enters.
    target.search = "";
    // The status is Vercel's: it serves the rewritten static file with the
    // status given here, and a 200 otherwise. Next.js's own server sets 404
    // for this path regardless (see above).
    return NextResponse.rewrite(target, { status: 404, headers: { "Cache-Control": REVALIDATE_EACH_TIME } });
  }
  target.pathname = decision.path;
  return NextResponse.redirect(target, { status: 308, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // Only requests the proxy can answer, so an ASCII canonical page path (the
  // common case, an ISR hit) never pays for it: every `/resources/**` path, for the
  // `/page/1/` rule and the library's shapes; every other `/api/**` path,
  // which is reserved and a 404, except the revalidate route itself; any
  // other path with an upper-case ASCII letter, a percent escape or a
  // repeated slash (the redirect), a dot or a segment over 200 characters
  // (not a page segment), except the metadata files (`OWN_ROUTE_PATHS`: the
  // favicon, the icons and the share image), which are routes, and outside
  // the uploads rewrite and the framework's assets, which are not pages and
  // which `lib/path-decision.ts` leaves alone regardless; and any other path
  // over the plugin's cap on a page path (2010 characters), which no
  // narrower rule need catch. Next.js compiles a matcher with path-to-regexp
  // and tests it at runtime with `new RegExp(regexp)` and no flags, so
  // `[A-Z]` is case-sensitive there; `test/proxy-matcher.test.ts` compiles
  // these the same way and checks they reach every path the decision would
  // act on and no ASCII canonical page path. A percent-encoded canonical page
  // path (`/%e6%97%a5/`) does run it and gets nothing back: telling its
  // escapes from ones the redirect fixes (upper-case hex, an escape Next.js
  // decodes, NFD form) needs decoding, which a matcher cannot do. A repeated
  // slash is collapsed by Next.js's own 308 before the proxy runs.
  matcher: [
    "/resources/:path*",
    "/api/((?!revalidate/?$).*)",
    "/((?!_next/|api/|media/|(?:favicon\\.ico|icon\\.svg|icon\\.png|apple-icon\\.png|opengraph-image\\.png)$).*(?:[A-Z%.]|//|[^/]{201}).*)",
    "/((?!_next/|api/|media/).{2010,})",
  ],
};

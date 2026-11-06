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
 * canonical path with `Cache-Control: no-store`. ADR 0035's 2026-11-05
 * amendment on the listings records why the listings' redirects are here and
 * not in the pages (a `permanentRedirect()` from an ISR page is stored), and
 * its 2026-11-06 amendment with ADR 0052's why the rule now covers every
 * path: the resource page and the pages catch-all are ISR too, and Next.js's
 * stored entry is keyed by the decoded path, which a case-insensitive file
 * system shares between `/About/` and `/about/`, so a mixed-case request
 * that reached either route first would store a redirect at the canonical
 * path's own key. A proxy redirect with no data costs about a fifth of a
 * millisecond, and the proxy adds about a tenth of one to every other
 * matched request; the matcher below keeps canonical page paths out of it.
 *
 * The 404 (issue #46): a path no route could answer with anything but
 * `notFound()`, decided by the routes' own checks, is rewritten to the
 * prerendered `/_not-found` route, which is the one way on Next.js 16.4.5
 * to put `app/not-found.tsx` in the HTML: a `notFound()` from a page sends
 * the framework's empty `__next_error__` document, with the page arriving
 * on hydration (ADR 0050's 2026-11-05 amendment). The rewrite is internal
 * (the browser keeps its URL), the server sets the 404 status and `noindex`
 * itself, and the prerendered route answers an RSC request too. The
 * response leaves Next.js with `s-maxage=31536000` and nothing for a
 * browser, so the rewrite carries the `Cache-Control` every other 404 of
 * the app's routes carries (`lib/route-headers.ts`, ADR 0025 as amended):
 * a browser asks again each time, and nothing here outlives a deploy that
 * adds a route. Nothing is stored for the path: the route cache gets no
 * entry per junk URL, where the catch-all's `notFound()` stored one (ADR
 * 0052's note on junk paths).
 *
 * This proxy never reads the data layer: its `fetch` is not the Data Cache's,
 * so a CMS request here would reach the CMS on every matched request. What
 * needs data (an unknown type or topic, a page past the end, a wrong type
 * segment or an old slug on a resource, a wrong parent on a page, a path no
 * page has) is the route's to decide, and its 404 still has the empty body.
 *
 * The redirect's target keeps the request's query string. Next.js requires
 * the redirect's URL to be absolute, and then writes a path-only `Location`
 * for one on the request's own origin. Next.js's own trailing-slash 308 runs
 * before this, so a slashless non-canonical path takes two hops (ADR 0035).
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
    return NextResponse.rewrite(target, { headers: { "Cache-Control": REVALIDATE_EACH_TIME } });
  }
  target.pathname = decision.path;
  return NextResponse.redirect(target, { status: 308, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // Only requests the proxy can answer, so a canonical page path (the common
  // case, an ISR hit) never pays for it: every `/resources/**` path, for the
  // `/page/1/` rule and the library's shapes; every other `/api/**` path,
  // which is reserved and a 404, except the revalidate route itself; any
  // other path with an upper-case ASCII letter, a percent escape or a
  // repeated slash (the redirect), a dot or a segment over 200 characters
  // (not a page segment), except the favicon, which is a route, and outside
  // the uploads rewrite and the framework's assets, which are not pages and
  // which `lib/path-decision.ts` leaves alone regardless; and any other path
  // over the plugin's cap on a page path (2010 characters), which no
  // narrower rule need catch. Next.js compiles a matcher with path-to-regexp
  // and tests it at runtime with `new RegExp(regexp)` and no flags, so
  // `[A-Z]` is case-sensitive there; `test/proxy-matcher.test.ts` compiles
  // these the same way and checks they reach every path the decision would
  // act on and no canonical page path. A repeated slash is collapsed by
  // Next.js's own 308 before the proxy runs.
  matcher: [
    "/resources/:path*",
    "/api/((?!revalidate/?$).*)",
    "/((?!_next/|api/|media/|favicon\\.ico$).*(?:[A-Z%.]|//|[^/]{201}).*)",
    "/((?!_next/|api/|media/).{2010,})",
  ],
};

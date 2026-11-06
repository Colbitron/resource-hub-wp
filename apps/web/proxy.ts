import { NextResponse, type NextRequest } from "next/server";

import { canonicalPath } from "./lib/canonical-path";

/**
 * Canonical-form redirects for every public path, decided from the path
 * alone (`lib/canonical-path.ts`): an upper-case letter in any segment, or a
 * trailing `/page/1/` on a listing, gets one 308 to the canonical path with
 * `Cache-Control: no-store`, before any route runs. ADR 0035's 2026-11-05
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
 * This proxy never reads the data layer: its `fetch` is not the Data Cache's,
 * so a CMS request here would reach the CMS on every matched request. What
 * needs data (an unknown type or topic, a page past the end, a wrong type
 * segment or an old slug on a resource, a wrong parent on a page) is the
 * route's to decide.
 *
 * The target keeps the request's query string. Next.js requires the
 * redirect's URL to be absolute, and then writes a path-only `Location` for
 * one on the request's own origin. Next.js's own trailing-slash 308 runs
 * before this, so a slashless non-canonical path takes two hops (ADR 0035).
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  const canonical = canonicalPath(request.nextUrl.pathname);
  if (canonical === null) {
    return undefined;
  }
  const target = request.nextUrl.clone();
  target.pathname = canonical;
  return NextResponse.redirect(target, { status: 308, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // Only requests that can need a redirect, so a canonical page path (the
  // common case, an ISR hit) never pays for the proxy: every `/resources/**`
  // path, for the `/page/1/` rule, and any other path with an upper-case
  // ASCII letter, a percent escape or a repeated slash, outside the
  // revalidate route, the uploads rewrite and the framework's assets, which
  // are not pages and which `lib/canonical-path.ts` leaves alone regardless.
  // Next.js compiles a matcher with path-to-regexp and tests it at runtime
  // with `new RegExp(regexp)` and no flags, so `[A-Z]` is case-sensitive
  // there; `test/proxy-matcher.test.ts` compiles these the same way. A
  // repeated slash is collapsed by Next.js's own 308 before the proxy runs.
  matcher: ["/resources/:path*", "/((?!_next/|api/|media/).*(?:[A-Z%]|//).*)"],
};

import { NextResponse, type NextRequest } from "next/server";

import { canonicalResourcesPath } from "./lib/canonical-path";

/**
 * Canonical-form redirects for `/resources/**`, decided from the path alone
 * (`lib/canonical-path.ts`): an upper-case letter in a segment, or a
 * trailing `/page/1/`, gets one 308 to the canonical path with
 * `Cache-Control: no-store`, before any route runs. ADR 0035's 2026-11-05
 * amendment on the listings records why it is here and not in the pages: a
 * `permanentRedirect()` from an ISR page is prerendered and stored with
 * `s-maxage`, which the contract forbids for a permanent redirect, while a
 * proxy redirect with no data costs about half a millisecond and the proxy
 * adds about a tenth of one to every other `/resources/**` request.
 *
 * This proxy never reads the data layer: its `fetch` is not the Data Cache's,
 * so a CMS request here would reach the CMS on every matched request. What
 * needs data (an unknown type or topic, a page past the end, a wrong type
 * segment or an old slug on a resource) is the route's to decide.
 *
 * The target keeps the request's query string. Next.js requires the
 * redirect's URL to be absolute, and then writes a path-only `Location` for
 * one on the request's own origin. Next.js's own trailing-slash 308 runs
 * before this, so a slashless non-canonical path takes two hops (ADR 0035).
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  const canonical = canonicalResourcesPath(request.nextUrl.pathname);
  if (canonical === null) {
    return undefined;
  }
  const target = request.nextUrl.clone();
  target.pathname = canonical;
  return NextResponse.redirect(target, { status: 308, headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // The library, every listing and every resource page, and nothing else:
  // static files, the image optimiser and the API route never pay for it.
  matcher: "/resources/:path*",
};
